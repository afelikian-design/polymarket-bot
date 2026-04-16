import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const generatePnL = () => {
  const data = []; let bal = 1000;
  const now = Date.now();
  for (let i = 96; i >= 0; i--) {
    bal = Math.max(820, bal + (Math.random() - 0.36) * 38);
    data.push({ time: new Date(now - i * 15 * 60 * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), balance: +bal.toFixed(2) });
  }
  return data;
};

// opened_at_seconds = seconds ago this position was opened (for live timer)
const POSITIONS = [
  { question: "Will the Fed cut rates before July 2025?",        entry_price: 0.52, current_price: 0.61, size_usd: 114, our_probability: 0.72, thesis: "Market underpricing Fed dovish pivot — T1 whale confirmed", unrealized_pnl: 19.83,  whale_copy: true,  has_thesis: true,  opened_at_sec: 7440,   max_hours: 24 },
  { question: "Will BTC exceed $100K by end of April?",          entry_price: 0.38, current_price: 0.44, size_usd: 87,  our_probability: 0.58, thesis: "Crowd anchored to ATH resistance — ETF inflows accelerating", unrealized_pnl: 13.74, whale_copy: false, has_thesis: true,  opened_at_sec: 18900,  max_hours: 24 },
  { question: "Will Nvidia beat Q1 EPS estimates?",              entry_price: 0.71, current_price: 0.68, size_usd: 203, our_probability: 0.82, thesis: "Data center demand consistent with guidance; sell-side lowballed", unrealized_pnl: -8.54, whale_copy: false, has_thesis: true, opened_at_sec: 41400, max_hours: 24 },
  { question: "Will Ukraine ceasefire be signed before May?",    entry_price: 0.19, current_price: 0.23, size_usd: 55,  our_probability: 0.34, thesis: "European diplomatic pressure intensifying; mkt anchored to pessimism", unrealized_pnl: 11.58, whale_copy: true,  has_thesis: false, opened_at_sec: 64800, max_hours: 8  },
];

const TRADES = [
  { question: "Will CPI print below 3.0% in March?",            pnl: 212.40, exit_reason: "TARGET_HIT",   entry_price: 0.44, exit_price: 0.71, held: "6h 14m" },
  { question: "Will Trump issue executive order on crypto?",     pnl: 88.20,  exit_reason: "TARGET_HIT",   entry_price: 0.33, exit_price: 0.51, held: "11h 02m" },
  { question: "Will Senate pass AI regulation bill in Q1?",      pnl: -41.00, exit_reason: "STALE_THESIS", entry_price: 0.28, exit_price: 0.22, held: "24h 00m" },
  { question: "Will Apple announce Vision Pro 2 at WWDC?",       pnl: 156.80, exit_reason: "VOLUME_EXIT",  entry_price: 0.41, exit_price: 0.64, held: "3h 47m" },
  { question: "Will SpaceX Starship reach orbit in April?",      pnl: 334.10, exit_reason: "TARGET_HIT",   entry_price: 0.29, exit_price: 0.68, held: "9h 31m" },
];

const QUEUE = [
  { question: "Will ECB cut rates in June 2025?",   price: 0.63, our_probability: 0.79, edge: 0.16, confidence: 88, thesis: "Inflation trajectory + Lagarde signals ignored by market" },
  { question: "Will Meta Q2 revenue beat consensus?",price: 0.58, our_probability: 0.74, edge: 0.16, confidence: 82, thesis: "AI monetization underpriced in analyst models" },
  { question: "Will gold hit $3500 before July?",   price: 0.31, our_probability: 0.46, edge: 0.15, confidence: 77, thesis: "Central bank buying trend; mkt using old flows data" },
];

const WHALES = [
  { address: "0x3f8a...c41d", tier: 1, win_rate: 0.81, total_pnl: 184200, total_trades: 847,  best_category: "macro",    signal_weight: 1.0,  active: true  },
  { address: "0x7c2b...9f3e", tier: 1, win_rate: 0.78, total_pnl: 142800, total_trades: 623,  best_category: "politics", signal_weight: 1.0,  active: true  },
  { address: "0xa91e...2b7c", tier: 1, win_rate: 0.76, total_pnl: 118400, total_trades: 1204, best_category: "crypto",   signal_weight: 1.0,  active: false },
  { address: "0x5d4f...8a1b", tier: 2, win_rate: 0.72, total_pnl: 84100,  total_trades: 441,  best_category: "politics", signal_weight: 0.75, active: true  },
  { address: "0x2e9c...f6d4", tier: 2, win_rate: 0.71, total_pnl: 71300,  total_trades: 382,  best_category: "macro",    signal_weight: 0.75, active: false },
  { address: "0x8b7a...3c9f", tier: 2, win_rate: 0.69, total_pnl: 58200,  total_trades: 298,  best_category: "crypto",   signal_weight: 0.75, active: true  },
  { address: "0x1f3d...7e2a", tier: 3, win_rate: 0.67, total_pnl: 41800,  total_trades: 189,  best_category: "other",    signal_weight: 0.5,  active: false },
  { address: "0x4c8e...b5f1", tier: 3, win_rate: 0.65, total_pnl: 34600,  total_trades: 224,  best_category: "macro",    signal_weight: 0.5,  active: true  },
];

const INIT_SIGNALS = [
  { wallet: "0x3f8a...c41d", tier: 1, question: "Will the Fed cut rates before July 2025?",      entry_price: 0.54, size_usd: 8400,  has_thesis: true,  action: "FOLLOWED", kelly: "100%", detected_at: "4m ago"  },
  { wallet: "0x7c2b...9f3e", tier: 1, question: "Will Trump sign crypto executive order in Q2?", entry_price: 0.41, size_usd: 12100, has_thesis: false, action: "FOLLOWED", kelly: "50%",  detected_at: "17m ago" },
  { wallet: "0x5d4f...8a1b", tier: 2, question: "Will ECB cut rates in June 2025?",              entry_price: 0.63, size_usd: 3800,  has_thesis: true,  action: "FOLLOWED", kelly: "75%",  detected_at: "34m ago" },
  { wallet: "0x8b7a...3c9f", tier: 2, question: "Will BTC exceed $100K by end of April?",        entry_price: 0.38, size_usd: 5200,  has_thesis: true,  action: "FOLLOWED", kelly: "75%",  detected_at: "51m ago" },
  { wallet: "0x1f3d...7e2a", tier: 3, question: "Will Nvidia beat Q1 EPS estimates?",            entry_price: 0.69, size_usd: 2100,  has_thesis: false, action: "SKIPPED",  kelly: "—",    detected_at: "1h ago"  },
  { wallet: "0x4c8e...b5f1", tier: 3, question: "Will Meta Q2 revenue beat consensus?",          entry_price: 0.57, size_usd: 1800,  has_thesis: true,  action: "FOLLOWED", kelly: "50%",  detected_at: "2h ago"  },
];

const FAKE_QS = [
  "Will the Fed hold rates at June FOMC?","Will ETH outperform BTC in Q2?",
  "Will UK inflation drop below 3% by May?","Will Apple hit $250 before earnings?",
];

// ─── Helpers ────────────────────────────────────────────────
const fmt$   = n => `$${Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtK   = n => n>=1000?`$${(n/1000).toFixed(1)}K`:fmt$(n);
const fmtPct = n => `${(n*100).toFixed(1)}%`;
const sign   = n => n>=0?"+":"";

const TC = {1:"#f0c070",2:"#80c8e0",3:"#607888"};
const TB = {1:"#1e1000",2:"#001222",3:"#0e1218"};
const TL = {1:"ELITE",  2:"STRONG", 3:"WATCH" };
const CC = {macro:"#a080f0",politics:"#e07888",crypto:"#00c8a0",other:"#5a7080"};

const TierBadge = ({tier}) => (
  <span style={{fontSize:8,padding:"2px 6px",borderRadius:2,letterSpacing:".14em",background:TB[tier],color:TC[tier],border:`1px solid ${TC[tier]}28`,fontWeight:600}}>
    T{tier} {TL[tier]}
  </span>
);
const CatBadge = ({cat}) => (
  <span style={{fontSize:8,padding:"2px 5px",borderRadius:2,letterSpacing:".1em",color:CC[cat]||"#5a7080",background:(CC[cat]||"#5a7080")+"18"}}>
    {cat?.toUpperCase()}
  </span>
);

// Format seconds → "Xh Ym" or "Ym Zs"
const fmtDuration = (secs) => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,"0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2,"0")}s`;
  return `${s}s`;
};

// Stale bar color: green→amber→red based on % of max hold time
const staleColor = (pct) => {
  if (pct < 0.5)  return "#00a858";
  if (pct < 0.75) return "#d4a020";
  if (pct < 0.90) return "#e06020";
  return "#ff4040";
};

const staleLabel = (pct) => {
  if (pct < 0.5)  return null;
  if (pct < 0.75) return "WATCH";
  if (pct < 0.90) return "AGING";
  return "STALE SOON";
};

export default function Dashboard() {
  const [pnlData]       = useState(generatePnL);
  const [tab, setTab]   = useState("positions");
  const [wTab, setWTab] = useState("leaderboard");
  const [elapsed, setElapsed] = useState(0);   // seconds since component mount — drives live timers
  const [signals, setSignals] = useState(INIT_SIGNALS);
  const [newSig,  setNewSig]  = useState(false);
  const [sigTick, setSigTick] = useState(0);

  // Live clock — tick every second for timer column
  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e+1), 1000);
    return () => clearInterval(t);
  }, []);

  // Simulate new whale signals
  useEffect(() => {
    const t = setInterval(() => setSigTick(x => x+1), 4000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (sigTick > 0 && sigTick % 5 === 0) {
      const w = WHALES[Math.floor(Math.random()*WHALES.length)];
      const ht = Math.random() > 0.35;
      const fw = w.tier < 3 || ht;
      setSignals(prev => [{
        wallet: w.address, tier: w.tier,
        question: FAKE_QS[Math.floor(Math.random()*FAKE_QS.length)],
        entry_price: +(Math.random()*0.45+0.28).toFixed(3),
        size_usd: Math.floor(Math.random()*9000+1500),
        has_thesis: ht, action: fw?"FOLLOWED":"SKIPPED",
        kelly: fw?({1:"100%",2:"75%",3:"50%"}[w.tier]):"—",
        detected_at: "just now",
      }, ...prev.slice(0,9)]);
      setNewSig(true); setTimeout(()=>setNewSig(false),800);
    }
  }, [sigTick]);

  const portfolio = {balance:1382.47,daily_pnl:382.47,win_rate:0.74,open_positions:4,drawdown_pct:-0.031,sharpe:2.31,total_trades:214};
  const p0 = pnlData[0]?.balance??1000, pN = pnlData[pnlData.length-1]?.balance??1000, pd = pN-p0;

  const agents = {
    scanner:       {status:"idle",    msg:"482 mkts → 38 passed",         ago:"3m"},
    brain:         {status:"running", msg:"Evaluating 38 markets...",      ago:"now"},
    executor:      {status:"idle",    msg:"4 trades placed today",         ago:"47m"},
    exit_monitor:  {status:"idle",    msg:"Watching 4 positions",          ago:"28s"},
    whale_monitor: {status:"running", msg:`Polling ${WHALES.length} wallets...`, ago:"now"},
  };

  return (
    <div style={{background:"#07090c",minHeight:"100vh",fontFamily:"'DM Mono',monospace",color:"#b0c8d4",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:#08090c}::-webkit-scrollbar-thumb{background:#18283a}
        .pulse{animation:pulse 2s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
        .blink{animation:blink 1.2s step-end infinite}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        .slidein{animation:si .35s ease}
        @keyframes si{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
        .rh:hover{background:rgba(0,200,120,.025)!important}
        .tb{background:none;border:none;cursor:pointer;font-family:inherit}
        .timer-bar{transition:width .9s linear}
      `}</style>

      {/* TOP BAR */}
      <div style={{background:"#070a0d",borderBottom:"1px solid #0c1c28",padding:"9px 22px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:"#00ff8c",boxShadow:"0 0 9px #00ff8c"}} className="pulse"/>
            <span style={{fontWeight:500,fontSize:13,color:"#00ff8c",letterSpacing:".14em"}}>POLYBOT</span>
          </div>
          <div style={{width:1,height:14,background:"#0c1c28"}}/>
          <span style={{fontSize:9,color:"#283840",letterSpacing:".1em"}}>PAPER MODE</span>
          <div style={{width:1,height:14,background:"#0c1c28"}}/>
          <span style={{fontSize:9,color:"#182028"}}>{new Date().toUTCString().slice(5,22)} <span className="blink">_</span></span>
        </div>
        <div style={{display:"flex",gap:28}}>
          {[
            {l:"BALANCE",  v:fmt$(portfolio.balance),       c:"#d8eef8"},
            {l:"TODAY",    v:`+${fmt$(portfolio.daily_pnl)}`,c:"#00ff8c"},
            {l:"WIN RATE", v:fmtPct(portfolio.win_rate),   c:"#f0c070"},
            {l:"SHARPE",   v:portfolio.sharpe.toFixed(2),  c:"#80c8e0"},
            {l:"DRAWDOWN", v:fmtPct(portfolio.drawdown_pct),c:"#3a5868"},
            {l:"🐋 WHALES",v:`${WHALES.length} tracked`,  c:newSig?"#ffdd80":"#8a6820"},
          ].map(({l,v,c})=>(
            <div key={l} style={{textAlign:"right"}}>
              <div style={{fontSize:8,color:"#202c38",letterSpacing:".16em",marginBottom:2}}>{l}</div>
              <div style={{fontSize:12,color:c,fontWeight:500,transition:"color .3s"}}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* GRID */}
      <div style={{display:"grid",gridTemplateColumns:"196px 1fr 256px",height:"calc(100vh - 46px)"}}>

        {/* LEFT */}
        <div style={{background:"#070a0d",borderRight:"1px solid #0c1c28",padding:"14px 11px",overflowY:"auto",display:"flex",flexDirection:"column",gap:7}}>
          <div style={{fontSize:8,color:"#202c38",letterSpacing:".2em",marginBottom:4}}>AGENTS</div>
          {Object.entries(agents).map(([name,a])=>(
            <div key={name} style={{padding:"8px 10px",background:"#0a0d12",border:`1px solid ${a.status==="running"?"#0a2418":"#0c1820"}`,borderRadius:3}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{fontSize:9,color:"#7a9aaa",letterSpacing:".06em"}}>{name.replace(/_/g," ").toUpperCase()}</span>
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <div style={{width:5,height:5,borderRadius:"50%",background:a.status==="running"?"#00ff8c":"#202c38",boxShadow:a.status==="running"?"0 0 5px #00ff8c":"none"}} className={a.status==="running"?"pulse":""}/>
                  <span style={{fontSize:8,color:a.status==="running"?"#00cc70":"#303c48",letterSpacing:".1em"}}>{a.status.toUpperCase()}</span>
                </div>
              </div>
              <div style={{fontSize:9,color:"#304858",lineHeight:1.5}}>{a.msg}</div>
              <div style={{fontSize:8,color:"#16222c",marginTop:3}}>{a.ago} ago</div>
            </div>
          ))}
          <div style={{marginTop:8}}>
            <div style={{fontSize:8,color:"#202c38",letterSpacing:".2em",marginBottom:8}}>RISK ENGINE</div>
            {[["Kelly Cap","10%"],["Daily Loss","−10%"],["Max Draw","−20%"],["Open Pos",`${portfolio.open_positions}/10`]].map(([l,v])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid #09090d"}}>
                <span style={{fontSize:9,color:"#283840"}}>{l}</span>
                <span style={{fontSize:9,color:"#009858"}}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{marginTop:8,padding:"9px 10px",background:"#0b0d08",border:"1px solid #182400",borderRadius:3}}>
            <div style={{fontSize:8,color:"#4a7828",letterSpacing:".16em",marginBottom:7}}>WHALE TIERS</div>
            {[1,2,3].map(t=>{
              const all=WHALES.filter(w=>w.tier===t), act=all.filter(w=>w.active);
              return (
                <div key={t} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0"}}>
                  <TierBadge tier={t}/>
                  <span style={{fontSize:8,color:"#283840"}}>{act.length}/{all.length} active</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* CENTER */}
        <div style={{display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {/* Chart */}
          <div style={{background:"#090c10",borderBottom:"1px solid #0c1c28",padding:"13px 18px",flexShrink:0}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <span style={{fontSize:8,color:"#202c38",letterSpacing:".2em"}}>PORTFOLIO · 24H</span>
              <div style={{display:"flex",gap:14}}>
                <span style={{fontSize:12,color:pd>=0?"#00ff8c":"#ff4455",fontWeight:500,textShadow:pd>=0?"0 0 12px rgba(0,255,140,.4)":"none"}}>{sign(pd)}{fmt$(pd)}</span>
                <span style={{fontSize:11,color:"#304858"}}>{sign(pd)}{((pd/p0)*100).toFixed(2)}%</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={100}>
              <LineChart data={pnlData} margin={{top:2,right:2,bottom:0,left:0}}>
                <defs>
                  <linearGradient id="lg" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#006840"/><stop offset="100%" stopColor="#00ff8c"/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{fill:"#182028",fontSize:8}} axisLine={false} tickLine={false} interval={23}/>
                <YAxis tick={{fill:"#182028",fontSize:8}} axisLine={false} tickLine={false} width={44} tickFormatter={v=>`$${v.toFixed(0)}`} domain={["auto","auto"]}/>
                <Tooltip contentStyle={{background:"#0b0e14",border:"1px solid #0c1c28",borderRadius:3,fontSize:10}} labelStyle={{color:"#304858"}} itemStyle={{color:"#00ff8c"}} formatter={v=>[fmt$(v),"Balance"]}/>
                <ReferenceLine y={p0} stroke="#182028" strokeDasharray="3 3"/>
                <Line type="monotone" dataKey="balance" stroke="url(#lg)" strokeWidth={1.5} dot={false} activeDot={{r:3,fill:"#00ff8c"}}/>
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Tabs */}
          <div style={{display:"flex",borderBottom:"1px solid #0c1c28",background:"#070a0d",flexShrink:0}}>
            {[["positions",POSITIONS.length],["trades",TRADES.length],["queue",QUEUE.length],["🐋 signals",signals.length]].map(([t,n])=>{
              const key = t.replace("🐋 ","");
              return (
                <button key={key} className="tb" onClick={()=>setTab(key)} style={{padding:"8px 16px",fontSize:9,letterSpacing:".12em",color:tab===key?"#00ff8c":"#242c38",borderBottom:tab===key?"2px solid #00ff8c":"2px solid transparent",marginBottom:-1,transition:"color .15s",position:"relative"}}>
                  {t.toUpperCase()}
                  <span style={{marginLeft:5,fontSize:8,color:tab===key?"#009860":"#182028"}}>{n}</span>
                  {t.includes("signal")&&newSig&&<span style={{position:"absolute",top:4,right:4,width:4,height:4,borderRadius:"50%",background:"#f0c070",boxShadow:"0 0 5px #f0c070"}} className="pulse"/>}
                </button>
              );
            })}
          </div>

          {/* Content */}
          <div style={{flex:1,overflowY:"auto"}}>

            {/* ── POSITIONS with live hold timer ── */}
            {tab==="positions" && (
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                <thead style={{background:"#070a0d",position:"sticky",top:0,zIndex:10}}>
                  <tr>
                    {["MARKET","ENTRY","NOW","EST.","SIZE","UNRLZD","HOLD TIME"].map(h=>(
                      <th key={h} style={{padding:"7px 10px",textAlign:"left",color:"#202c38",fontSize:8,letterSpacing:".12em",fontWeight:400,borderBottom:"1px solid #0c1c28",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {POSITIONS.map((p,i)=>{
                    const totalSec    = p.opened_at_sec + elapsed;
                    const maxSec      = p.max_hours * 3600;
                    const pct         = Math.min(totalSec / maxSec, 1);
                    const barColor    = staleColor(pct);
                    const urgency     = staleLabel(pct);
                    const timeStr     = fmtDuration(totalSec);
                    const maxStr      = `${p.max_hours}h`;
                    const remaining   = Math.max(0, maxSec - totalSec);
                    const remStr      = fmtDuration(remaining);

                    return (
                      <tr key={i} className="rh" style={{borderBottom:"1px solid #07080b"}}>
                        {/* Market */}
                        <td style={{padding:"10px 10px",maxWidth:200}}>
                          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                            {p.whale_copy&&<span style={{fontSize:7,color:"#f0c070",background:"#1e1000",padding:"1px 5px",borderRadius:2,letterSpacing:".1em",whiteSpace:"nowrap"}}>🐋 {p.has_thesis?"COPY":"COPY·NOTX"}</span>}
                            <span style={{color:"#8ab8c8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:180}}>{p.question}</span>
                          </div>
                          <div style={{fontSize:8,color:"#243848"}}>{p.thesis.slice(0,52)}…</div>
                        </td>
                        {/* Entry */}
                        <td style={{padding:"10px 10px",color:"#3a5060",whiteSpace:"nowrap"}}>{p.entry_price.toFixed(3)}</td>
                        {/* Current */}
                        <td style={{padding:"10px 10px",color:p.current_price>p.entry_price?"#00a858":"#ff4455",whiteSpace:"nowrap"}}>{p.current_price.toFixed(3)}</td>
                        {/* Our est */}
                        <td style={{padding:"10px 10px",color:"#f0c070",whiteSpace:"nowrap"}}>{fmtPct(p.our_probability)}</td>
                        {/* Size */}
                        <td style={{padding:"10px 10px",color:"#80b0c0",whiteSpace:"nowrap"}}>{fmt$(p.size_usd)}</td>
                        {/* Unrealized PnL */}
                        <td style={{padding:"10px 10px",color:p.unrealized_pnl>=0?"#00a858":"#ff4455",fontWeight:500,whiteSpace:"nowrap"}}>{sign(p.unrealized_pnl)}{fmt$(p.unrealized_pnl)}</td>

                        {/* ── HOLD TIME CELL ── */}
                        <td style={{padding:"10px 10px",minWidth:130}}>
                          {/* Timer + limit */}
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                            <span style={{fontSize:10,color:barColor,fontWeight:500,letterSpacing:".04em",fontVariantNumeric:"tabular-nums"}}>{timeStr}</span>
                            <span style={{fontSize:8,color:"#283848"}}>/{maxStr}</span>
                          </div>

                          {/* Progress bar */}
                          <div style={{background:"#0d1018",height:3,borderRadius:2,overflow:"hidden",marginBottom:4}}>
                            <div className="timer-bar" style={{background:barColor,height:"100%",width:`${pct*100}%`,borderRadius:2,boxShadow:pct>0.85?`0 0 6px ${barColor}`:"none"}}/>
                          </div>

                          {/* Remaining + urgency badge */}
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <span style={{fontSize:8,color:"#283848"}}>{remStr} left</span>
                            {urgency&&(
                              <span style={{fontSize:7,padding:"1px 5px",borderRadius:2,letterSpacing:".12em",
                                background: pct>=0.9?"#280800":pct>=0.75?"#1e1200":"#141a00",
                                color: pct>=0.9?"#ff5020":pct>=0.75?"#e08020":"#a09020",
                                animation: pct>=0.9?"pulse 1.5s ease-in-out infinite":"none",
                              }}>
                                {urgency}
                              </span>
                            )}
                            {/* Whale exit leash indicator */}
                            {p.whale_copy&&!p.has_thesis&&(
                              <span style={{fontSize:7,color:"#8a6820",letterSpacing:".1em"}}>8H CAP</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {/* TRADES */}
            {tab==="trades" && (
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                <thead style={{background:"#070a0d",position:"sticky",top:0}}>
                  <tr>{["MARKET","ENTRY","EXIT","P&L","REASON","HELD"].map(h=>(
                    <th key={h} style={{padding:"7px 10px",textAlign:"left",color:"#202c38",fontSize:8,letterSpacing:".12em",fontWeight:400,borderBottom:"1px solid #0c1c28"}}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {TRADES.map((t,i)=>(
                    <tr key={i} className="rh" style={{borderBottom:"1px solid #07080b"}}>
                      <td style={{padding:"10px 10px",color:"#8ab8c8",maxWidth:240}}>
                        <div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.question}</div>
                      </td>
                      <td style={{padding:"10px 10px",color:"#304858",whiteSpace:"nowrap"}}>{t.entry_price.toFixed(2)}</td>
                      <td style={{padding:"10px 10px",color:"#80b0c0",whiteSpace:"nowrap"}}>{t.exit_price.toFixed(2)}</td>
                      <td style={{padding:"10px 10px",fontWeight:500,color:t.pnl>=0?"#00a858":"#ff4455",whiteSpace:"nowrap"}}>{sign(t.pnl)}{fmt$(t.pnl)}</td>
                      <td style={{padding:"10px 10px"}}>
                        <span style={{fontSize:8,padding:"2px 6px",borderRadius:2,letterSpacing:".1em",
                          background:t.exit_reason==="TARGET_HIT"?"#002010":t.exit_reason==="STOP_LOSS"?"#240010":"#141400",
                          color:t.exit_reason==="TARGET_HIT"?"#00a858":t.exit_reason==="STOP_LOSS"?"#ff4455":"#a09020"}}>
                          {t.exit_reason}
                        </span>
                      </td>
                      <td style={{padding:"10px 10px",color:"#3a5868",fontSize:9,whiteSpace:"nowrap"}}>{t.held}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* QUEUE */}
            {tab==="queue" && (
              <div style={{padding:"12px"}}>
                {QUEUE.map((q,i)=>(
                  <div key={i} style={{background:"#0a0d12",border:"1px solid #0c1c28",borderLeft:"3px solid #007848",borderRadius:3,padding:"11px 13px",marginBottom:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                      <span style={{fontSize:10,color:"#8ab8c8"}}>{q.question}</span>
                      <span style={{fontSize:8,padding:"2px 7px",background:"#002010",color:"#00a858",borderRadius:2,letterSpacing:".1em",whiteSpace:"nowrap",marginLeft:10}}>BUY → {fmtPct(q.our_probability)}</span>
                    </div>
                    <div style={{display:"flex",gap:16,marginBottom:5}}>
                      <span style={{fontSize:9,color:"#304858"}}>Mkt: <span style={{color:"#80b0c0"}}>{q.price.toFixed(2)}</span></span>
                      <span style={{fontSize:9,color:"#304858"}}>Edge: <span style={{color:"#f0c070"}}>+{fmtPct(q.edge)}</span></span>
                      <span style={{fontSize:9,color:"#304858"}}>Conf: <span style={{color:"#00a858"}}>{q.confidence}</span></span>
                    </div>
                    <div style={{fontSize:9,color:"#304858",fontStyle:"italic"}}>"{q.thesis}"</div>
                  </div>
                ))}
              </div>
            )}

            {/* SIGNALS */}
            {tab==="signals" && (
              <div style={{padding:"12px"}}>
                {signals.map((s,i)=>(
                  <div key={i} className={i===0?"slidein":""} style={{background:"#09090d",border:`1px solid ${s.action==="FOLLOWED"?TC[s.tier]+"22":"#1c1010"}`,borderLeft:`3px solid ${s.action==="FOLLOWED"?TC[s.tier]:"#3a1818"}`,borderRadius:3,padding:"10px 12px",marginBottom:7,opacity:s.action==="SKIPPED"?0.45:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                      <TierBadge tier={s.tier}/>
                      <span style={{fontSize:9,color:"#3a5868",flex:1}}>{s.wallet}</span>
                      <span style={{fontSize:8,padding:"2px 6px",borderRadius:2,letterSpacing:".1em",background:s.action==="FOLLOWED"?"#001a0e":"#1c0808",color:s.action==="FOLLOWED"?"#00a858":"#ff4455"}}>{s.action}</span>
                      {s.action==="FOLLOWED"&&<span style={{fontSize:8,padding:"2px 6px",background:"#08182a",color:"#70b8d8",borderRadius:2}}>KELLY {s.kelly}</span>}
                    </div>
                    <div style={{fontSize:10,color:"#80aac0",marginBottom:6}}>{s.question}</div>
                    <div style={{display:"flex",alignItems:"center",gap:14}}>
                      <span style={{fontSize:9,color:"#304858"}}>Entry: <span style={{color:"#80aac0"}}>{s.entry_price.toFixed(3)}</span></span>
                      <span style={{fontSize:9,color:"#304858"}}>Size: <span style={{color:"#f0c070"}}>{fmtK(s.size_usd)}</span></span>
                      {s.has_thesis?<span style={{fontSize:8,color:"#009050",background:"#001408",padding:"1px 6px",borderRadius:2}}>✓ THESIS MATCH</span>:<span style={{fontSize:8,color:"#404858",background:"#0c0e12",padding:"1px 6px",borderRadius:2}}>no thesis</span>}
                      <div style={{flex:1}}/>
                      <span style={{fontSize:8,color:"#202830"}}>{s.detected_at}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: WHALE PANEL */}
        <div style={{background:"#070a0d",borderLeft:"1px solid #0c1c28",display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{display:"flex",borderBottom:"1px solid #0c1c28",flexShrink:0}}>
            {["leaderboard","stats"].map(t=>(
              <button key={t} className="tb" onClick={()=>setWTab(t)} style={{flex:1,padding:"9px 0",fontSize:8,letterSpacing:".14em",color:wTab===t?"#f0c070":"#202c38",borderBottom:wTab===t?"2px solid #f0c070":"2px solid transparent",marginBottom:-1,transition:"color .15s"}}>
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"10px"}}>
            {wTab==="leaderboard"&&(
              <>
                <div style={{fontSize:8,color:"#202c38",letterSpacing:".18em",marginBottom:10}}>TRACKED WALLETS · {WHALES.length} TOTAL</div>
                {WHALES.map((w,i)=>(
                  <div key={i} style={{background:"#09090e",border:"1px solid #0c1820",borderRadius:3,padding:"9px 10px",marginBottom:7}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                      <div style={{width:5,height:5,borderRadius:"50%",background:w.active?"#00ff8c":"#202c38",boxShadow:w.active?"0 0 5px #00ff8c":"none"}} className={w.active?"pulse":""}/>
                      <span style={{fontSize:9,color:"#3a5868",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{w.address}</span>
                      <TierBadge tier={w.tier}/>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,marginBottom:7}}>
                      {[["WIN RATE",fmtPct(w.win_rate),"#00a858"],["TOTAL PnL",fmtK(w.total_pnl),"#f0c070"],["TRADES",w.total_trades,"#70a8c0"]].map(([l,v,c])=>(
                        <div key={l}>
                          <div style={{fontSize:7,color:"#202c38",letterSpacing:".1em",marginBottom:2}}>{l}</div>
                          <div style={{fontSize:12,color:c,fontWeight:500}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                      <CatBadge cat={w.best_category}/>
                      <span style={{fontSize:8,color:"#283848"}}>wt {fmtPct(w.signal_weight)}</span>
                    </div>
                    <div style={{background:"#0d1018",height:2,borderRadius:1}}>
                      <div style={{background:TC[w.tier],height:"100%",width:fmtPct(w.win_rate),borderRadius:1,opacity:.65}}/>
                    </div>
                  </div>
                ))}
              </>
            )}
            {wTab==="stats"&&(
              <>
                <div style={{fontSize:8,color:"#202c38",letterSpacing:".18em",marginBottom:10}}>PERFORMANCE</div>
                {[
                  {l:"TOTAL P&L",     v:"+$382.47",c:"#00ff8c",big:true},
                  {l:"WIN RATE",      v:"74.3%",   c:"#f0c070",big:true},
                  {l:"WHALE WIN RATE",v:"80.6%",   c:"#00a858"},
                  {l:"THESIS-ONLY WR",v:"70.2%",   c:"#00a858"},
                  {l:"TOTAL TRADES",  v:"214",     c:"#80c8e0"},
                  {l:"WHALE FOLLOWS", v:"31",      c:"#f0c070"},
                  {l:"SHARPE",        v:"2.31",    c:"#a080f0"},
                  {l:"AVG WIN",       v:"+$197.88",c:"#00a858"},
                  {l:"AVG LOSS",      v:"−$34.67", c:"#ff4455"},
                  {l:"AVG HOLD TIME", v:"7h 14m",  c:"#80c8e0"},
                  {l:"BEST TRADE",    v:"+$334.10",c:"#00a858"},
                ].map(({l,v,c,big})=>(
                  <div key={l} style={{padding:"7px 0",borderBottom:"1px solid #08090c"}}>
                    <div style={{fontSize:8,color:"#202c38",letterSpacing:".14em",marginBottom:3}}>{l}</div>
                    <div style={{fontSize:big?18:13,color:c,fontWeight:big?500:400,textShadow:big&&c==="#00ff8c"?"0 0 12px rgba(0,255,140,.35)":"none"}}>{v}</div>
                  </div>
                ))}
                <div style={{marginTop:12}}>
                  <div style={{fontSize:8,color:"#202c38",letterSpacing:".18em",marginBottom:8}}>EXIT BREAKDOWN</div>
                  {[["Target Hit",4,.57,"#00a858"],["Volume Exit",1,.14,"#f0c070"],["Stale Thesis",1,.14,"#988020"],["Stop Loss",1,.14,"#ff4455"]].map(([l,n,pct,c])=>(
                    <div key={l} style={{marginBottom:8}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                        <span style={{fontSize:9,color:"#304858"}}>{l}</span>
                        <span style={{fontSize:9,color:c}}>{n} · {fmtPct(pct)}</span>
                      </div>
                      <div style={{background:"#0c0e14",height:2,borderRadius:1}}>
                        <div style={{background:c,height:"100%",width:fmtPct(pct),borderRadius:1,opacity:.7}}/>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
