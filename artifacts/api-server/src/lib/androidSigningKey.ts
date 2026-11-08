import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type AndroidSigningKey = {
  id: string;
  deviceId: string | null;
  alias: string;
  storePassword: string;
  keyPassword: string;
  certificateSha256: string;
  scheme: Array<"v1" | "v2" | "v3">;
  platform: "android";
  createdAt: string;
  storeFile: string;
};

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  return result.stdout || "";
}

function workspaceRoot(): string {
  let candidate = resolve(process.cwd());
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(candidate, "artifacts/agon-control/android-agent"))) return candidate;
    const parent = resolve(candidate, "..");
    if (parent === candidate) break;
    candidate = parent;
  }
  return resolve(process.cwd());
}

export function findBaseAndroidApk(): string | null {
  const root = workspaceRoot();
  const names = [
    "artifacts/agon-control/public/agent/agon-agent-android-universal-v1.0.4.apk",
    "artifacts/agon-control/dist/public/agent/agon-agent-android-universal-v1.0.4.apk",
  ];
  for (const name of names) {
    const full = join(root, name);
    if (existsSync(full)) return full;
  }
  return null;
}

export async function createAndroidSigningKey(deviceId?: string | null): Promise<AndroidSigningKey> {
  const id = randomUUID();
  const alias = `agon-${id.replace(/-/g, "").slice(0, 12)}`;
  const storePassword = randomBytes(24).toString("base64url");
  const keyPassword = randomBytes(24).toString("base64url");
  const directory = join(workspaceRoot(), "data", "signing-keys");
  await mkdir(directory, { recursive: true });
  const storeFile = join(directory, `${id}.p12`);
  run("keytool", [
    "-genkeypair",
    "-alias", alias,
    "-keyalg", "RSA",
    "-keysize", "2048",
    "-validity", "10000",
    "-storetype", "PKCS12",
    "-keystore", storeFile,
    "-storepass", storePassword,
    "-keypass", keyPassword,
    "-dname", "CN=Agon Agent, OU=Endpoint Signing, O=Agon, C=US",
  ]);
  await chmod(storeFile, 0o600);
  const listed = run("keytool", [
    "-list", "-v",
    "-keystore", storeFile,
    "-storepass", storePassword,
    "-alias", alias,
  ]);
  if (/CN=Android Debug/i.test(listed)) {
    throw new Error("Refusing an Android debug certificate.");
  }
  const certificateSha256 = listed.match(/SHA256:\s*([0-9A-F:]+)/i)?.[1]?.toLowerCase() || "";
  if (!certificateSha256) throw new Error("The new signing certificate did not report a SHA-256 fingerprint.");
  return {
    id,
    deviceId: deviceId || null,
    alias,
    storePassword,
    keyPassword,
    certificateSha256,
    scheme: ["v1", "v2", "v3"],
    platform: "android",
    createdAt: new Date().toISOString(),
    storeFile,
  };
}

export async function signApkWithKey(key: AndroidSigningKey): Promise<Buffer | null> {
  const base = findBaseAndroidApk();
  if (!base) return null;
  const apksigner = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    join(workspaceRoot(), "android-sdk"),
  ].filter(Boolean).map((root) => join(String(root), "build-tools", "37.0.0", "apksigner"))
    .find((candidate) => candidate && existsSync(candidate));
  if (!apksigner) return null;
  const work = join(tmpdir(), `agon-apk-${key.id}`);
  await mkdir(work, { recursive: true });
  const unsigned = join(work, "unsigned.apk");
  const signed = join(work, "signed.apk");
  try {
    await copyFile(base, unsigned);
    spawnSync("zip", ["-d", unsigned, "META-INF/*"], { encoding: "utf8" });
    run(apksigner, [
      "sign",
      "--ks", key.storeFile,
      "--ks-pass", `pass:${key.storePassword}`,
      "--key-pass", `pass:${key.keyPassword}`,
      "--ks-key-alias", key.alias,
      "--v1-signing-enabled", "true",
      "--v2-signing-enabled", "true",
      "--v3-signing-enabled", "true",
      "--out", signed,
      unsigned,
    ]);
    const verified = run(apksigner, ["verify", "--verbose", "--print-certs", signed]);
    if (/CN=Android Debug/i.test(verified) || !/Verified using v2 scheme \(APK Signature Scheme v2\): true/.test(verified)) {
      throw new Error("Signed APK failed the release signature check.");
    }
    return await readFile(signed);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
