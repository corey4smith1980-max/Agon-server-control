import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const hostedControlPlaneUrl =
  "https://agon-server-control.replit.app/deployment/api/agon";
const upgradeCode = "7B8D5814-8D31-4C81-ACF9-B75B8599A7F0";

type AgentArtifact = {
  platform: string;
  arch: string;
  file: string;
  bytes: number;
  sha256: string;
  version: string;
};

type AgentManifest = {
  version: string;
  artifacts: AgentArtifact[];
};

export type WindowsMsiInput = {
  architecture: "amd64";
  organizationId: string;
  group: string;
  allowUnattended: boolean;
};

export type WindowsMsiOutput = {
  buffer: Buffer;
  filename: string;
  version: string;
  agentSha256: string;
};

function findWorkspaceRoot(): string {
  let candidate = resolve(process.cwd());
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(candidate, "artifacts/agon-control/public/agent/manifest.json"))) {
      return candidate;
    }
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error("The verified Windows agent manifest is unavailable on this server.");
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function runWixl(args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("wixl", args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output = `${output}${chunk}`.slice(-6000);
    });
    child.stderr.on("data", (chunk: string) => {
      output = `${output}${chunk}`.slice(-6000);
    });
    child.on("error", (error) => {
      reject(
        new Error(
          error.message.includes("ENOENT")
            ? "Windows MSI packaging is unavailable on this server."
            : `Could not start MSI packaging: ${error.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`MSI packaging failed${output ? `: ${output.trim()}` : "."}`));
    });
  });
}

function wixDocument(binaryPath: string, configPath: string, version: string, architecture: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="Agon Agent" Language="1033" Version="${xml(version)}" Manufacturer="Agon" UpgradeCode="${upgradeCode}">
    <Package InstallerVersion="500" Compressed="yes" InstallScope="perMachine" Platform="${architecture}" />
    <Media Id="1" Cabinet="agon-agent.cab" EmbedCab="yes" />
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="ProgramFiles64Folder">
        <Directory Id="INSTALLDIR" Name="Agon">
          <Component Id="AgentService" Guid="B0A9EBD4-5DE8-4D6E-886B-87C8CF72B8D1" Win64="yes">
            <File Id="AgonAgentExe" Source="${xml(binaryPath)}" Name="agon-agent.exe" KeyPath="yes" />
            <ServiceInstall Id="AgonAgentServiceInstall" Name="AgonAgent" DisplayName="Agon Agent" Description="Agon consent-based endpoint support agent" Type="ownProcess" Start="auto" ErrorControl="normal" Account="LocalSystem" Arguments="-config &quot;[AGENTDATA]agent.json&quot;" />
            <ServiceControl Id="AgonAgentServiceControl" Name="AgonAgent" Start="install" Stop="both" Remove="uninstall" Wait="yes" />
          </Component>
        </Directory>
      </Directory>
      <Directory Id="CommonAppDataFolder">
        <Directory Id="AGENTDATA" Name="Agon">
          <Component Id="AgentConfiguration" Guid="594E0131-2BA0-4C3E-8BA2-D776AC3BE756" Win64="yes">
            <File Id="AgonAgentConfig" Source="${xml(configPath)}" KeyPath="yes" />
          </Component>
        </Directory>
      </Directory>
      <Directory Id="ProgramMenuFolder">
        <Directory Id="AgonProgramMenu" Name="Agon Agent">
          <Component Id="VisibleCompanionShortcut" Guid="812E9B56-17B8-4F52-90B4-8199E8ED7819" Win64="yes">
            <Shortcut Id="AgonCompanionShortcut" Name="Agon Desktop Companion" Description="View device pairing status and connect the visible support companion" Target="[INSTALLDIR]agon-agent.exe" Arguments="-config &quot;[AGENTDATA]agent.json&quot; -companion" WorkingDirectory="INSTALLDIR" />
            <RegistryValue Root="HKCU" Key="Software\Microsoft\Windows\CurrentVersion\Run" Name="AgonDesktopCompanion" Type="string" Value="&quot;[INSTALLDIR]agon-agent.exe&quot; -config &quot;[AGENTDATA]agent.json&quot; -companion" KeyPath="yes" />
            <RemoveFolder Id="RemoveAgonProgramMenu" Directory="AgonProgramMenu" On="uninstall" />
          </Component>
        </Directory>
      </Directory>
    </Directory>
    <Feature Id="AgonAgentFeature" Title="Agon Agent" Level="1">
      <ComponentRef Id="AgentService" />
      <ComponentRef Id="AgentConfiguration" />
      <ComponentRef Id="VisibleCompanionShortcut" />
    </Feature>
  </Product>
</Wix>`;
}

export async function buildWindowsMsi(input: WindowsMsiInput): Promise<WindowsMsiOutput> {
  if (input.architecture !== "amd64") {
    throw new Error("The MSI builder currently supports Windows x64. Use the ARM64 package for Windows on ARM.");
  }
  if (!input.organizationId || input.organizationId.length > 128) {
    throw new Error("The active organization could not be determined.");
  }
  const root = findWorkspaceRoot();
  const publicAgentDir = join(root, "artifacts/agon-control/public/agent");
  const manifest = JSON.parse(
    await readFile(join(publicAgentDir, "manifest.json"), "utf8"),
  ) as AgentManifest;
  const artifact = manifest.artifacts.find(
    (item) => item.platform === "windows" && item.arch === input.architecture,
  );
  if (!artifact || !/^\/agent\/agon-agent-windows-amd64\.exe$/.test(artifact.file)) {
    throw new Error(`No trusted Windows ${input.architecture} agent build is available.`);
  }
  const binaryPath = resolve(publicAgentDir, basename(artifact.file));
  if (!binaryPath.startsWith(`${resolve(publicAgentDir)}/`)) {
    throw new Error("The agent artifact path is invalid.");
  }
  const binary = await readFile(binaryPath);
  const hash = createHash("sha256").update(binary).digest("hex");
  if (binary.byteLength !== artifact.bytes || hash !== artifact.sha256.toLowerCase()) {
    throw new Error("The Windows agent checksum does not match the published build manifest.");
  }

  const config = JSON.stringify(
    {
      serverUrl: hostedControlPlaneUrl,
      ownerId: input.organizationId,
      deviceName: "",
      group: input.group,
      allowUnattended: input.allowUnattended,
    },
    null,
    2,
  ) + "\n";
  const tempDir = await mkdtemp(join(tmpdir(), "agon-agent-msi-"));
  const configPath = join(tempDir, "agent.json");
  const wxsPath = join(tempDir, "agent.wxs");
  const msiPath = join(tempDir, "agon-agent.msi");
  try {
    await writeFile(configPath, config, { mode: 0o600 });
    await writeFile(
      wxsPath,
      wixDocument(
        binaryPath,
        configPath,
        artifact.version,
        "x64",
      ),
    );
    await runWixl(["--arch", "x64", "--output", msiPath, wxsPath]);
    const buffer = await readFile(msiPath);
    if (buffer.byteLength < 1024) {
      throw new Error("The MSI build completed without producing a valid installer.");
    }
    return {
      buffer,
      filename: `agon-agent-windows-${input.architecture}-v${artifact.version}.msi`,
      version: artifact.version,
      agentSha256: hash,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
