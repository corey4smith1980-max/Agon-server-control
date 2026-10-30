import { motion } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';

const EASE = [0.22, 1, 0.36, 1] as const;
const INK = '#111918';
const LIME = '#c4f36a';
const SILVER = '#d8e0d8';
const MONO: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '1.12vmin',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
};

function GrainGrid({ warm = false }: { warm?: boolean }) {
  return (
    <>
      <div className={`absolute inset-0 ${warm ? 'field-lines-warm' : 'field-lines'}`} />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: warm
            ? 'radial-gradient(ellipse at 72% 45%, rgba(196,243,106,.10), transparent 36%), linear-gradient(105deg, transparent 45%, rgba(17,25,24,.035) 45.1%, transparent 45.3%)'
            : 'radial-gradient(ellipse at 68% 50%, rgba(196,243,106,.085), transparent 27%), radial-gradient(ellipse at 10% 92%, rgba(106,139,123,.09), transparent 32%)',
        }}
      />
    </>
  );
}

function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ ...MONO, color: 'rgba(216,224,216,.48)', ...style }}>
      {children}
    </div>
  );
}

function RouteLine({ d, delay = 0 }: { d: string; delay?: number }) {
  return (
    <motion.path
      d={d}
      fill="none"
      stroke={LIME}
      strokeWidth="2"
      strokeLinecap="round"
      strokeDasharray="5 10"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 0.8 }}
      transition={{ duration: 1.05, delay, ease: EASE }}
    />
  );
}

export function Scene01() {
  return (
    <motion.section
      className="absolute inset-0 overflow-hidden"
      style={{ background: INK, color: SILVER }}
      initial={{ opacity: 0, scale: 1.035 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.06, filter: 'blur(8px)' }}
      transition={{ duration: 0.42, ease: EASE }}
    >
      <GrainGrid />
      <div className="absolute left-[6%] top-[10%]">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.42, ease: EASE }}
        >
          <Eyebrow>AGON / SERVER CONTROL</Eyebrow>
        </motion.div>
        <motion.h1
          className="m-0 mt-[4.4vh] max-w-[44vw] font-display font-semibold leading-[0.92] tracking-[-0.065em]"
          style={{ fontSize: '9vmin', color: '#f0f2e9' }}
          initial={{ clipPath: 'inset(0 0 100% 0)' }}
          animate={{ clipPath: 'inset(0 0 0% 0)' }}
          transition={{ delay: 0.48, duration: 0.72, ease: EASE }}
        >
          One control<br />
          <span style={{ color: LIME }}>plane.</span>
        </motion.h1>
        <motion.div
          className="mt-[4vh] h-px bg-white/15"
          initial={{ width: 0 }}
          animate={{ width: '21vw' }}
          transition={{ delay: 1.08, duration: 0.55, ease: EASE }}
        />
      </div>

      <div className="absolute right-[7%] top-[15%] h-[69%] w-[51%]">
        <motion.div
          className="absolute inset-[8%] rounded-full border border-white/[.09]"
          animate={{ rotate: 360 }}
          transition={{ duration: 42, repeat: Infinity, ease: 'linear' }}
        >
          <div className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rounded-full bg-white/35" />
        </motion.div>
        <motion.div
          className="absolute inset-[18%] rounded-full border border-dashed border-lime-200/15"
          animate={{ rotate: -360 }}
          transition={{ duration: 55, repeat: Infinity, ease: 'linear' }}
        />
        <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 760 560">
          <RouteLine d="M112 280 C215 280 223 280 333 280" delay={0.95} />
          <RouteLine d="M427 280 C535 280 548 280 648 280" delay={1.7} />
          <motion.path
            d="M112 280 C215 280 223 280 333 280 M427 280 C535 280 548 280 648 280"
            fill="none"
            stroke="rgba(196,243,106,.9)"
            strokeWidth="3"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: [0, 0, 1, 1], opacity: [0, 0, 1, 0] }}
            transition={{ duration: 3.1, delay: 2.8, times: [0, 0.06, 0.54, 1], ease: 'linear' }}
          />
          {[112, 380, 648].map((cx, i) => (
            <g key={cx}>
              <circle cx={cx} cy="280" r={i === 1 ? 46 : 31} fill={i === 1 ? '#17231e' : '#18201d'} stroke={i === 1 ? 'rgba(196,243,106,.72)' : 'rgba(219,229,220,.34)'} strokeWidth="2" />
              <circle cx={cx} cy="280" r={i === 1 ? 35 : 21} fill="none" stroke={i === 1 ? 'rgba(196,243,106,.22)' : 'rgba(219,229,220,.13)'} />
              <circle cx={cx} cy="280" r={i === 1 ? 8 : 5} fill={i === 1 ? LIME : '#d9e2d9'} />
            </g>
          ))}
          <motion.circle
            cx="112"
            cy="280"
            r="6"
            fill={LIME}
            initial={{ cx: 112, opacity: 0 }}
            animate={{ cx: [112, 380, 648, 380], opacity: [0, 1, 1, 0] }}
            transition={{ delay: 3.2, duration: 1.25, ease: 'easeInOut' }}
          />
        </svg>
        <motion.div className="absolute left-[3%] top-[53%]" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.5, duration: 0.35 }}>
          <Eyebrow style={{ color: 'rgba(240,242,233,.75)' }}>Console</Eyebrow>
        </motion.div>
        <motion.div className="absolute left-[40%] top-[53%]" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.2, duration: 0.35 }}>
          <Eyebrow style={{ color: LIME }}>Hosted relay</Eyebrow>
        </motion.div>
        <motion.div className="absolute right-[-1%] top-[53%]" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.9, duration: 0.35 }}>
          <Eyebrow style={{ color: 'rgba(240,242,233,.75)' }}>Endpoint agent</Eyebrow>
        </motion.div>
        <div className="absolute bottom-[3%] right-[3%] font-mono text-[1vmin] tracking-[.2em] text-white/25">
          01 / CONTROL PLANE
        </div>
      </div>
      <motion.div
        className="absolute left-[49.8%] top-[48.8%] z-10 h-[2.2vmin] w-[2.2vmin] rounded-[.55vmin] bg-[#c4f36a]"
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: [0, 1, 1, 8], rotate: [0, 0, 0, 45], opacity: [1, 1, 1, 0] }}
        transition={{ delay: 4.15, duration: 1, times: [0, 0.12, 0.45, 1], ease: EASE }}
      />
    </motion.section>
  );
}

export function Scene02() {
  return (
    <motion.section
      className="absolute inset-0 overflow-hidden"
      style={{ background: '#14201d', color: SILVER }}
      initial={{ opacity: 0, scale: 1.08, filter: 'blur(10px)' }}
      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, scale: 1.07, filter: 'blur(7px)' }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      <div className="absolute inset-0" style={{ background: 'linear-gradient(120deg, rgba(196,243,106,.055), transparent 38%), radial-gradient(ellipse at 55% 49%, rgba(196,243,106,.12), transparent 44%)' }} />
      <div className="absolute left-[6%] top-[9%] z-10">
        <Eyebrow>OUTBOUND · ENCRYPTED TRANSPORT</Eyebrow>
        <h2 className="m-0 mt-[2.5vh] font-display text-[7.5vmin] font-medium leading-none tracking-[-.06em] text-[#f1f2e9]">
          Agent <span className="text-[#c4f36a]">↔</span> relay
        </h2>
      </div>
      <motion.div
        className="absolute left-[5%] top-[47%] h-[1px] w-[61%] origin-left bg-lime-200/35"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: 0.42, duration: 0.9, ease: EASE }}
      />
      <div className="absolute left-[5%] top-[29%] h-[43%] w-[62%]">
        <motion.div className="absolute left-[12%] top-[31%] flex h-[16vmin] w-[16vmin] items-center justify-center rounded-full border border-white/25 bg-[#1a2823]" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.26, duration: 0.58, ease: EASE }}>
          <div className="absolute inset-[18%] rounded-full border border-dashed border-white/20" />
          <span className="font-mono text-[1.1vmin] tracking-[.15em] text-white/55">AGENT</span>
          <motion.div className="absolute h-[1.25vmin] w-[1.25vmin] rounded-sm bg-[#c4f36a]" animate={{ x: [0, 430, 430], opacity: [1, 1, 0] }} transition={{ delay: 0.85, duration: 1.8, ease: [0.45, 0, 0.55, 1] }} />
        </motion.div>
        <motion.div className="absolute left-[61%] top-[24%] flex h-[19vmin] w-[19vmin] items-center justify-center rounded-[50%] border border-lime-200/60 bg-[#18251f] shadow-[inset_0_0_50px_rgba(196,243,106,.08)]" initial={{ scale: 0.6, opacity: 0, rotate: -25 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ delay: 0.82, duration: 0.72, ease: EASE }}>
          <div className="absolute inset-[10%] rounded-full border border-white/10" />
          <div className="flex flex-col items-center gap-[1vh]">
            <div className="h-[1vmin] w-[1vmin] rounded-full bg-[#c4f36a]" />
            <span className="font-mono text-[.9vmin] tracking-[.15em] text-white/55">RELAY</span>
          </div>
        </motion.div>
        <motion.div className="absolute left-[17%] top-[76%] rounded border border-white/10 bg-[#111918]/80 px-[1.1vw] py-[.85vh] font-mono text-[1.08vmin] text-white/60" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.4, duration: 0.38 }}>
          <span className="mr-[.7vw] text-[#c4f36a]">PULSE</span> heartbeat
        </motion.div>
        <motion.div className="absolute left-[45%] top-[72%] rounded border border-lime-200/20 bg-[#111918]/90 px-[1.1vw] py-[.85vh] font-mono text-[1.08vmin] text-white/65" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.2, duration: 0.38 }}>
          inventory.refresh
        </motion.div>
      </div>
      <motion.div
        className="absolute right-[8%] top-[24%] h-[51%] w-[26%] border border-white/10 bg-[#18211e]/85 p-[2.1vw]"
        style={{ transformOrigin: '50% 50%' }}
        initial={{ opacity: 0, rotateY: -24, x: 30 }}
        animate={{ opacity: 1, rotateY: 0, x: 0 }}
        transition={{ delay: 1.45, duration: 0.75, ease: EASE }}
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-[1.4vh]">
          <span className="font-mono text-[.9vmin] tracking-[.14em] text-white/38">CONNECTION</span>
          <span className="h-[.65vmin] w-[.65vmin] rounded-full bg-[#c4f36a]" />
        </div>
        <div className="mt-[2.5vh] font-display text-[2.6vmin] tracking-[-.04em] text-[#e7eee4]">Control relay</div>
        <div className="mt-[.9vh] font-mono text-[.95vmin] text-white/38">WSS · OUTBOUND ROUTE</div>
        <div className="mt-[3vh] space-y-[1.25vh]">
          <div className="h-[.7vh] w-[72%] bg-white/10" />
          <div className="h-[.7vh] w-[48%] bg-white/[.07]" />
          <div className="h-[.7vh] w-[61%] bg-white/[.07]" />
        </div>
        <motion.div className="absolute bottom-[9%] left-[8%] right-[8%] border border-[#dba95c]/45 bg-[#dba95c]/[.07] px-[1vw] py-[1.2vh]" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3.8, duration: 0.35 }}>
          <div className="font-mono text-[.85vmin] tracking-[.14em] text-[#dba95c]">CURRENT ESTATE</div>
          <div className="mt-[.7vh] font-display text-[1.55vmin] text-[#ead9bd]">No laptop enrolled yet</div>
        </motion.div>
      </motion.div>
      <motion.div
        className="absolute left-[48.5%] top-[47.5%] z-20 h-[2.2vmin] w-[2.2vmin] bg-[#c4f36a]"
        initial={{ scale: 0, rotate: 45 }}
        animate={{ scale: [0, 1, 1, 13], opacity: [1, 1, 1, 0], rotate: [45, 45, 45, 0] }}
        transition={{ delay: 4.85, duration: 0.85, times: [0, 0.15, 0.45, 1], ease: EASE }}
      />
    </motion.section>
  );
}

function ActionRow({ name, code, delay, disabled = false }: { name: string; code: string; delay: number; disabled?: boolean }) {
  return (
    <motion.div
      className={`relative flex h-[7.2vh] items-center justify-between border-b px-[1.35vw] ${disabled ? 'border-white/[.07] text-white/25' : 'border-white/[.11] text-[#e8eee4]'}`}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.38, ease: EASE }}
    >
      <div className="flex items-center gap-[1.1vw]">
        <span className={`flex h-[2.7vmin] w-[2.7vmin] items-center justify-center rounded-full border ${disabled ? 'border-white/10' : 'border-[#c4f36a]/40'}`}>
          <span className={`h-[.65vmin] w-[.65vmin] rounded-full ${disabled ? 'bg-white/15' : 'bg-[#c4f36a]'}`} />
        </span>
        <span className="font-display text-[1.75vmin]">{name}</span>
      </div>
      <span className="font-mono text-[.92vmin] tracking-[.08em] text-white/35">{code}</span>
      {disabled && <motion.div className="absolute left-[3%] right-[3%] top-1/2 h-[2px] origin-left bg-[#dba95c]/80" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: delay + 0.3, duration: 0.32, ease: EASE }} />}
    </motion.div>
  );
}

export function Scene03() {
  return (
    <motion.section
      className="absolute inset-0 overflow-hidden"
      style={{ background: '#111817', color: SILVER }}
      initial={{ opacity: 0, clipPath: 'inset(0 0 0 100%)' }}
      animate={{ opacity: 1, clipPath: 'inset(0 0 0 0%)' }}
      exit={{ opacity: 0, scale: 1.035, filter: 'blur(5px)' }}
      transition={{ duration: 0.55, ease: EASE }}
    >
      <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(196,243,106,.055), transparent 33%), radial-gradient(ellipse at 74% 47%, rgba(196,243,106,.07), transparent 34%)' }} />
      <div className="absolute left-[6%] top-[10%] w-[32%]">
        <Eyebrow>ACTIONS WITH BOUNDARIES</Eyebrow>
        <motion.h2
          className="m-0 mt-[2.5vh] font-display text-[7.5vmin] font-semibold leading-[.92] tracking-[-.07em] text-[#f0f2e9]"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.55, ease: EASE }}
        >
          A small,<br />visible
          <span className="block text-[#c4f36a]">allowlist.</span>
        </motion.h2>
        <motion.div className="mt-[3vh] font-mono text-[1.05vmin] tracking-[.12em] text-white/38" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9, duration: 0.4 }}>
          POLICY IS PART OF THE PRODUCT
        </motion.div>
        <motion.div
          className="absolute left-0 top-[41vh] font-display text-[3.8vmin] font-medium leading-[.95] tracking-[-.06em] text-[#f0f2e9]"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 4.95, duration: 0.42, ease: EASE }}
        >
          Not remote<br />
          <span className="text-white/40">desktop.</span>
        </motion.div>
      </div>
      <motion.div
        className="absolute right-[6%] top-[12%] h-[76%] w-[53%] border border-white/[.13] bg-[#1a2320]/95"
        initial={{ opacity: 0, rotateY: 14, x: 36, scale: 0.96 }}
        animate={{ opacity: 1, rotateY: 0, x: 0, scale: 1 }}
        transition={{ delay: 0.12, duration: 0.65, ease: EASE }}
      >
        <div className="flex h-[9vh] items-center justify-between border-b border-white/[.1] px-[2vw]">
          <div className="flex items-center gap-[.9vw]">
            <span className="h-[1.15vmin] w-[1.15vmin] rounded-sm bg-[#c4f36a]" />
            <span className="font-display text-[2vmin] tracking-[-.04em] text-[#eff3e9]">Support actions</span>
          </div>
          <span className="font-mono text-[.9vmin] tracking-[.14em] text-white/35">ENDPOINT POLICY</span>
        </div>
        <div className="px-[1.35vw]">
          <ActionRow name="Agent ping" code="agent.ping" delay={0.62} />
          <ActionRow name="Inventory refresh" code="inventory.refresh" delay={1.45} />
          <ActionRow name="Network diagnostics" code="diagnostics.network" delay={2.28} />
          <div className="h-[2.5vh]" />
          <ActionRow name="Arbitrary shell — not available" code="NOT ALLOWLISTED" delay={3.16} disabled />
        </div>
        <motion.div
          className="absolute bottom-[7%] left-[6%] flex items-center gap-[.8vw] border border-[#dba95c]/45 bg-[#dba95c]/[.07] px-[1.1vw] py-[1.1vh]"
          initial={{ opacity: 0, x: 14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 4.15, duration: 0.4, ease: EASE }}
        >
          <span className="h-[.7vmin] w-[.7vmin] rounded-full bg-[#dba95c]" />
          <span className="font-mono text-[.98vmin] tracking-[.06em] text-[#e5d0ae]">Endpoint approval may be required</span>
        </motion.div>
        <motion.div
          className="absolute -left-[7%] top-[31%] h-[39%] w-[114%] rounded-full border border-[#c4f36a]/60"
          initial={{ scale: 0.72, opacity: 0, rotate: -8 }}
          animate={{ scale: 1, opacity: [0, 0.95, 0.58], rotate: 0 }}
          transition={{ delay: 5.7, duration: 1.1, ease: EASE }}
        />
      </motion.div>
      <div className="absolute bottom-[5%] left-[6%] font-mono text-[.92vmin] tracking-[.18em] text-white/25">03 / CAPABILITY BOUNDARY</div>
    </motion.section>
  );
}

export function Scene04() {
  return (
    <motion.section
      className="absolute inset-0 overflow-hidden"
      style={{ background: '#e8e8d9', color: INK }}
      initial={{ opacity: 0, clipPath: 'inset(0 100% 0 0)' }}
      animate={{ opacity: 1, clipPath: 'inset(0 0% 0 0)' }}
      exit={{ opacity: 0, scale: 1.03 }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      <GrainGrid warm />
      <div className="absolute left-[6%] top-[13%] z-10 w-[45%]">
        <motion.div
          className="font-display text-[3.3vmin] font-semibold tracking-[-.07em] text-[#222e27]"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.4, ease: EASE }}
        >
          AGON
        </motion.div>
        <motion.h2
          className="m-0 mt-[3.1vh] font-display text-[7.4vmin] font-medium leading-[.94] tracking-[-.07em] text-[#19231f]"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.62, ease: EASE }}
        >
          Visible.<br />
          Bounded.<br />
          <span className="text-[#66705f]">Pending.</span>
        </motion.h2>
        <motion.p
          className="mt-[3vh] max-w-[34vw] font-body text-[2.05vmin] leading-[1.35] text-[#536057]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 0.48 }}
        >
          Hosted relay + consent-based endpoint agent
        </motion.p>
      </div>
      <motion.div
        className="absolute right-[7%] top-[13%] h-[69%] w-[39%]"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.22, duration: 0.7, ease: EASE }}
      >
        <motion.div className="absolute inset-[4%] rounded-full border border-[#657266]/30" animate={{ rotate: 360 }} transition={{ duration: 46, repeat: Infinity, ease: 'linear' }} />
        <motion.div className="absolute inset-[15%] rounded-full border border-dashed border-[#657266]/25" animate={{ rotate: -360 }} transition={{ duration: 38, repeat: Infinity, ease: 'linear' }} />
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 560 560">
          <motion.path d="M122 280 H438" fill="none" stroke="#8c9b86" strokeWidth="2" strokeDasharray="5 8" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 1, duration: 0.7, ease: EASE }} />
          <circle cx="126" cy="280" r="42" fill="#e8e8d9" stroke="#526056" strokeWidth="2" />
          <circle cx="280" cy="280" r="54" fill="#dfe4d2" stroke="#91a079" strokeWidth="2" />
          <circle cx="434" cy="280" r="42" fill="#e8e8d9" stroke="#b58d58" strokeWidth="2" strokeDasharray="7 8" />
          <circle cx="126" cy="280" r="7" fill="#2c3931" />
          <circle cx="280" cy="280" r="9" fill="#8ca96c" />
          <circle cx="434" cy="280" r="6" fill="#b58d58" />
          <motion.circle cx="126" cy="280" r="7" fill="#c4f36a" initial={{ cx: 126, opacity: 0 }} animate={{ cx: [126, 280, 434, 280], opacity: [0, 1, 1, 0] }} transition={{ delay: 1.8, duration: 1.4, ease: 'easeInOut' }} />
        </svg>
        <div className="absolute left-[7%] top-[59%] font-mono text-[.9vmin] tracking-[.13em] text-[#59655b]">CONSOLE</div>
        <div className="absolute left-[44%] top-[59%] font-mono text-[.9vmin] tracking-[.13em] text-[#59655b]">RELAY</div>
        <div className="absolute right-[2%] top-[59%] font-mono text-[.9vmin] tracking-[.13em] text-[#9a784b]">ENDPOINT</div>
        <motion.div
          className="absolute bottom-[3%] left-[9%] right-[9%] border border-[#b58d58]/65 bg-[#f0eddf]/90 px-[1.2vw] py-[1.3vh]"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.45, duration: 0.42, ease: EASE }}
        >
          <div className="flex items-center gap-[.7vw] font-mono text-[.92vmin] tracking-[.16em] text-[#98764a]">
            <span className="h-[.7vmin] w-[.7vmin] rounded-full bg-[#bd955b]" />
            CONNECTION STATUS
          </div>
          <div className="mt-[.6vh] font-display text-[1.8vmin] font-medium text-[#2a342d]">No laptop enrolled yet</div>
        </motion.div>
      </motion.div>
      <motion.div
        className="absolute bottom-[8%] left-[6%] max-w-[41vw] border-l-2 border-[#b58d58] pl-[1vw] font-mono text-[1.12vmin] leading-[1.55] text-[#586159]"
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 3.35, duration: 0.42, ease: EASE }}
      >
        Diagnostics are allowlisted. Arbitrary shell and full remote desktop are not available.
      </motion.div>
      <div className="absolute right-[6%] top-[6%] font-mono text-[.92vmin] tracking-[.17em] text-[#657266]/65">24.00 / SYSTEM MAP</div>
      <motion.div
        className="absolute left-[49.8%] top-[48.8%] z-20 h-[2.2vmin] w-[2.2vmin] rounded-[.55vmin] bg-[#c4f36a]"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: [0, 1, 1, 0], scale: [0.8, 1, 1, 7], x: [0, 0, 0, 20], y: [0, 0, 0, -15] }}
        transition={{ delay: 4.95, duration: 0.95, times: [0, 0.16, 0.48, 1], ease: EASE }}
      />
    </motion.section>
  );
}
