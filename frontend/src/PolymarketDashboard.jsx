import { useState, useEffect, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const API_BASE = "https://cutting-instrumental-distributors-disclosure.trycloudflare.com";

const generatePnL = () => {
  const data = []; let bal = 1000;
  const now = Date.now();
  for (let i = 96; i >= 0; i--) {
    bal = Math.max(820, bal + (Math.random() - 0.36) * 38);
    data.push({ time: new Date(now - i * 15 * 60 * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), balance: +bal.toFixed(2) });
  }
  return data;
};

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

const FAKE_QS = [
  "Will the Fed hold rates at June FOMC?","Will ETH outperform BTC in Q2?",
  "Will UK inflation drop below 3% by May?","Will Apple hit $250 before earnings?",
];

const fmt$   = n => `$${Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtK   = n => n>=1000?`$${(n/1000).toFixed(1)}K`:fmt$(n);
const fmtPct = n => `${(n*100).toFixed(1)}%`;
const sign   = n => n>=0?"+":"";

const TC = {1:"#f0c070",2:"#80c8e0",3:"#607888"};
const TB = {1:"#1e1000",2:"#001222",3:"#0e1218"};
const TL = {1:"ELITE",  2:"STRONG", 3:"WATCH" };
const CC = {macro:"#a080f0",politics:"#e07888",crypto:"#00c8a0",other:"#5a7080"};

// Event type config
const ET = {
  SCANNING:   { color: "#80c8e0", icon: "⟳", label: "SCAN"   },
  EVALUATING: { color: "#a080f0", icon: "◈", label: "EVAL"   },
  THESIS:     { color: "#00ff8c", icon: "✦", label: "THESIS" },
  TRADE:      { color: "#f0c070", icon: "◆", label: "TRADE"  },
  EXIT:       { color: "#e07888", icon: "✕", label: "EXIT"   },
  SKIP:       { color: "#4a5868", icon: "–", label: "SKIP"   },
  ERROR:      { color: "#ff4455", icon: "!", label: "ERROR"  },
};

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

const fmtDuration = (secs) => {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,"0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2,"0")}s`;
  return `${s}s`;
};
const staleColor = pct => pct < 0.5 ? "#00a858" : pct < 0.75 ? "#d4a020" : pct < 0.9 ? "#e06020" : "#ff4040";
const staleLabel = pct => pct < 0.5 ? null : pct < 0.75 ? "WATCH" : pct < 0.9 ? "AGING" : "STALE SOON";

export default function Dashboard() {
  const [pnlData]  = useState(generatePnL);
  const [tab, setTab]   = useState("positions");
  const [wTab, setWTab] = useState("leaderboard");
  const [elapsed, setElapsed] = useState(0);
  const [newSig, setNewSig]   = useState(false);
  const [sigTick, setSigTick] = useState(0);
  const [apiError, setApiError] = useState(false);
  const activityRef = useRef(null);

  // Real data
  const [portfolio, setPortfolio] = useState({
    balance:1000, daily_pnl:0, win_rate:0,
    open_positions:0, drawdown_pct:0, sharpe:0,
    total_trades:0, paper_trading:true
  });
  const [POSITIONS, setPositions] = useState([]);
  const [TRADES, setTrades]       = useState([]);
  const [QUEUE, setQueue]         = useState([]);
  const [signals, setSignals]     = useState([]);
  const [agentData, setAgentData] = useState({
    scanner:{status:"idle",message:"Starting..."},
    brain:{status:"idle",message:"Starting..."},
    executor:{status:"idle",message:"Starting..."},
    exit_monitor:{status:"idle",message:"Starting..."},
    whale_monitor:{status:"idle",message:"Starting..."},
  });
  const [activity, setActivity]   = useState([]);
  const [prevActivityId, setPrevActivityId] = useState(null);
  const [newActivity, setNewActivity] = useState(false);

  // Main data fetch — every 15s
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [port, pos, trd, agt, sig, queue] = await Promise.all([
          fetch(`${API_BASE}/api/portfolio`).then(r=>r.json()),
          fetch(`${API_BASE}/api/positions`).then(r=>r.json()),
          fetch(`${API_BASE}/api/trades`).then(r=>r.json()),
          fetch(`${API_BASE}/api/agents`).then(r=>r.json()),
          fetch(`${API_BASE}/api/whale_signals`).then(r=>r.json()),
          fetch(`${API_BASE}/api/queue`).then(r=>r.json()),
        ]);
        setPortfolio(port);
        setPositions(pos);
        setTrades(trd);
        setAgentData(agt);
        if (sig.length) setSignals(sig);
        setQueue(queue);
        setApiError(false);
      } catch(e) {
        console.error("API fetch failed:", e);
        setApiError(true);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  // Activity feed — every 5s
  useEffect(() => {
    const fetchActivity = async () => {
      try {
        const data = await fetch(`${API_BASE}/api/activity`).then(r=>r.json());
        if (data.length > 0 && data[0].id !== prevActivityId) {
          setNewActivity(true);
          setPrevActivityId(data[0].id);
          setTimeout(() => setNewActivity(false), 1000);
        }
        setActivity(data);
      } catch(e) {
        // activity feed failure is non-critical
      }
    };
    fetchActivity();
    const interval = setInterval(fetchActivity, 5000);
    return () => clearInterval(interval);
  }, [prevActivityId]);

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e+1), 1000);
    return () => clearInterval(t);
  }, []);

  // Whale signal simulation
  useEffect(() => {
    const t = setInterval(() => setSigTick(x => x+1), 4000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (signals.length === 0 && sigTick > 0 && sigTick % 5 === 0) {
      const w = WHALES[Math.floor(Math.random()*WHALES.length)];
      const ht = Math.random() > 0.35, fw = w.tier < 3 || ht;
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

  const p0 = pnlData[0]?.balance??1000, pN = pnlData[pnlData.length-1]?.balance??1000, pd = pN-p0;

  return (
    <div style={{background:"#07090c",minHeight:"100vh",fontFamily:"'DM Mono',monospace",color:"#ffffff",overflow:"hidden"}}>
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
        .flashrow{animation:fl .8s ease}
        @keyframes fl{0%{background:rgba(0,255,140,.08)}100%{background:transparent}}
        .rh:hover{background:rgba(0,200,120,.025)!important}
        .tb{background:none;border:none;cursor:pointer;font-family:inherit}
        .timer-bar{transition:width .9s linear}
        .feed-scroll::-webkit-scrollbar{width:2px}
      `}</style>

      {/* TOP BAR */}
      <div style={{background:"#070a0d",borderBottom:"1px solid #0c1c28",padding:"9px 22px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:apiError?"#ff4455":"#00ff8c",boxShadow:apiError?"0 0 9px #ff4455":"0 0 9px #00ff8c"}} className="pulse"/>
            <span style={{fontWeight:500,fontSize:13,color:apiError?"#ff4455":"#00ff8c",letterSpacing:".14em"}}>POLYBOT</span>
          </div>
          <div style={{width:1,height:14,background:"#0c1c28"}}/>
          <span style={{fontSize:9,color:portfolio.paper_trading?"#f0c070":"#00ff8c",letterSpacing:".1em"}}>{portfolio.paper_trading?"PAPER MODE":"LIVE"}</span>
          <div style={{width:1,height:14,background:"#0c1c28"}}/>
          <span style={{fontSize:9,color:"#c8d8e0"}}>{new Date().toUTCString().slice(5,22)} <span className="blink">_</span></span>
          {apiError&&<span style={{fontSize:9,color:"#ff4455",letterSpacing:".1em"}}>⚠ API OFFLINE</span>}
        </div>
        <div style={{display:"flex",gap:28}}>
          {[
            {l:"BALANCE",  v:fmt$(portfolio.balance),c:"#ffffff"},
            {l:"TODAY",    v:`${sign(portfolio.daily_pnl)}${fmt$(portfolio.daily_pnl)}`,c:portfolio.daily_pnl>=0?"#00ff8c":"#ff4455"},
            {l:"WIN RATE", v:fmtPct(portfolio.win_rate),c:"#f0c070"},
            {l:"TRADES",   v:`${portfolio.total_trades}`,c:"#80c8e0"},
            {l:"DRAWDOWN", v:fmtPct(portfolio.drawdown_pct),c:"#c8d8e0"},
            {l:"🐋 WHALES",v:`${WHALES.length} tracked`,c:newSig?"#ffdd80":"#f0c070"},
          ].map(({l,v,c})=>(
            <div key={l} style={{textAlign:"right"}}>
              <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".16em",marginBottom:2}}>{l}</div>
              <div style={{fontSize:12,color:c,fontWeight:500,transition:"color .3s"}}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* GRID */}
      <div style={{display:"grid",gridTemplateColumns:"196px 1fr 256px",height:"calc(100vh - 46px)"}}>

        {/* LEFT */}
        <div style={{background:"#070a0d",borderRight:"1px solid #0c1c28",padding:"14px 11px",overflowY:"auto",display:"flex",flexDirection:"column",gap:7}}>
          <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".2em",marginBottom:4}}>AGENTS</div>
          {Object.entries(agentData).map(([name,a])=>(
            <div key={name} style={{padding:"8px 10px",background:"#0a0d12",border:`1px solid ${a.status==="running"?"#0a2418":"#0c1820"}`,borderRadius:3}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{fontSize:9,color:"#ffffff",letterSpacing:".06em"}}>{name.replace(/_/g," ").toUpperCase()}</span>
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <div style={{width:5,height:5,borderRadius:"50%",background:a.status==="running"?"#00ff8c":a.status==="error"?"#ff4455":"#8ab8c8",boxShadow:a.status==="running"?"0 0 5px #00ff8c":"none"}} className={a.status==="running"?"pulse":""}/>
                  <span style={{fontSize:8,color:a.status==="running"?"#00cc70":a.status==="error"?"#ff4455":"#c8d8e0",letterSpacing:".1em"}}>{a.status?.toUpperCase()}</span>
                </div>
              </div>
              <div style={{fontSize:9,color:"#c8d8e0",lineHeight:1.5}}>{a.message}</div>
            </div>
          ))}
          <div style={{marginTop:8}}>
            <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".2em",marginBottom:8}}>RISK ENGINE</div>
            {[["Kelly Cap","10%"],["Daily Loss","−10%"],["Max Draw","−20%"],["Open Pos",`${portfolio.open_positions}/10`]].map(([l,v])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid #09090d"}}>
                <span style={{fontSize:9,color:"#c8d8e0"}}>{l}</span>
                <span style={{fontSize:9,color:"#00ff8c"}}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{marginTop:8,padding:"9px 10px",background:"#0b0d08",border:"1px solid #182400",borderRadius:3}}>
            <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".16em",marginBottom:7}}>WHALE TIERS</div>
            {[1,2,3].map(t=>{
              const all=WHALES.filter(w=>w.tier===t),act=all.filter(w=>w.active);
              return(
                <div key={t} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0"}}>
                  <TierBadge tier={t}/>
                  <span style={{fontSize:8,color:"#c8d8e0"}}>{act.length}/{all.length} active</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* CENTER */}
        <div style={{display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {/* ── LIVE ACTIVITY FEED ─────────────────────────── */}
          <div style={{
            background:"#080b0f",
            borderBottom:"1px solid #0c1c28",
            flexShrink:0,
            maxHeight:180,
            display:"flex",
            flexDirection:"column",
          }}>
            {/* Feed header */}
            <div style={{
              display:"flex",alignItems:"center",justifyContent:"space-between",
              padding:"7px 14px",borderBottom:"1px solid #0c1c28",flexShrink:0
            }}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{
                  width:6,height:6,borderRadius:"50%",
                  background:newActivity?"#00ff8c":"#304858",
                  boxShadow:newActivity?"0 0 7px #00ff8c":"none",
                  transition:"all .3s"
                }} className={newActivity?"pulse":""}/>
                <span style={{fontSize:8,color:"#8ab8c8",letterSpacing:".2em"}}>CLAUDE ACTIVITY FEED</span>
                <span style={{fontSize:8,color:"#304858"}}>· refreshes every 5s</span>
              </div>
              <div style={{display:"flex",gap:8}}>
                {Object.entries(ET).slice(0,5).map(([k,v])=>(
                  <span key={k} style={{fontSize:7,color:v.color,letterSpacing:".1em"}}>
                    {v.icon} {v.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Feed rows */}
            <div
              ref={activityRef}
              className="feed-scroll"
              style={{overflowY:"auto",flex:1,padding:"4px 0"}}
            >
              {activity.length === 0 ? (
                <div style={{padding:"16px 14px",color:"#304858",fontSize:10,textAlign:"center"}}>
                  Waiting for bot activity... (starts on next scan cycle)
                </div>
              ) : activity.map((log, i) => {
                const et = ET[log.event_type] || ET.SCANNING;
                return (
                  <div key={log.id} className={i===0&&newActivity?"flashrow":""} style={{
                    display:"flex",alignItems:"flex-start",gap:8,
                    padding:"4px 14px",
                    borderBottom:"1px solid #0a0c10",
                    transition:"background .3s",
                  }}>
                    {/* Time */}
                    <span style={{fontSize:8,color:"#243848",whiteSpace:"nowrap",marginTop:1,minWidth:52,fontVariantNumeric:"tabular-nums"}}>
                      {log.logged_at ? new Date(log.logged_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}) : ""}
                    </span>

                    {/* Event type badge */}
                    <span style={{
                      fontSize:7,padding:"1px 5px",borderRadius:2,letterSpacing:".12em",
                      background:et.color+"18",color:et.color,
                      whiteSpace:"nowrap",marginTop:1,minWidth:46,textAlign:"center",flexShrink:0
                    }}>
                      {et.icon} {et.label}
                    </span>

                    {/* Agent */}
                    <span style={{fontSize:8,color:"#4a7080",whiteSpace:"nowrap",marginTop:1,minWidth:60,flexShrink:0}}>
                      {log.agent?.replace(/_/g,"·")}
                    </span>

                    {/* Content */}
                    <div style={{flex:1,minWidth:0}}>
                      {log.market && (
                        <div style={{fontSize:8,color:"#8ab8c8",marginBottom:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          {log.market}
                        </div>
                      )}
                      <div style={{fontSize:9,color:et.color === "#4a5868" ? "#506070" : "#c8d8e0",lineHeight:1.4}}>
                        {log.message}
                      </div>
                      {log.detail && (
                        <div style={{fontSize:8,color:"#4a6070",marginTop:1,lineHeight:1.3}}>
                          {log.detail}
                        </div>
                      )}
                    </div>

                    {/* Time ago */}
                    <span style={{fontSize:7,color:"#243848",whiteSpace:"nowrap",marginTop:2,flexShrink:0}}>
                      {log.time_ago}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── PORTFOLIO CHART ─────────────────────────────── */}
          <div style={{background:"#090c10",borderBottom:"1px solid #0c1c28",padding:"13px 18px",flexShrink:0}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <span style={{fontSize:8,color:"#8ab8c8",letterSpacing:".2em"}}>PORTFOLIO · 24H</span>
              <div style={{display:"flex",gap:14}}>
                <span style={{fontSize:12,color:pd>=0?"#00ff8c":"#ff4455",fontWeight:500}}>{sign(pd)}{fmt$(pd)}</span>
                <span style={{fontSize:11,color:"#c8d8e0"}}>{sign(pd)}{((pd/p0)*100).toFixed(2)}%</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={80}>
              <LineChart data={pnlData} margin={{top:2,right:2,bottom:0,left:0}}>
                <defs>
                  <linearGradient id="lg" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#006840"/><stop offset="100%" stopColor="#00ff8c"/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{fill:"#8ab8c8",fontSize:8}} axisLine={false} tickLine={false} interval={23}/>
                <YAxis tick={{fill:"#8ab8c8",fontSize:8}} axisLine={false} tickLine={false} width={44} tickFormatter={v=>`$${v.toFixed(0)}`} domain={["auto","auto"]}/>
                <Tooltip contentStyle={{background:"#0b0e14",border:"1px solid #0c1c28",borderRadius:3,fontSize:10}} labelStyle={{color:"#c8d8e0"}} itemStyle={{color:"#00ff8c"}} formatter={v=>[fmt$(v),"Balance"]}/>
                <ReferenceLine y={p0} stroke="#8ab8c8" strokeDasharray="3 3"/>
                <Line type="monotone" dataKey="balance" stroke="url(#lg)" strokeWidth={1.5} dot={false} activeDot={{r:3,fill:"#00ff8c"}}/>
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Tabs */}
          <div style={{display:"flex",borderBottom:"1px solid #0c1c28",background:"#070a0d",flexShrink:0}}>
            {[["positions",POSITIONS.length],["trades",TRADES.length],["queue",QUEUE.length],["🐋 signals",signals.length]].map(([t,n])=>{
              const key=t.replace("🐋 ","");
              return(
                <button key={key} className="tb" onClick={()=>setTab(key)} style={{padding:"8px 16px",fontSize:9,letterSpacing:".12em",color:tab===key?"#00ff8c":"#8ab8c8",borderBottom:tab===key?"2px solid #00ff8c":"2px solid transparent",marginBottom:-1,transition:"color .15s",position:"relative"}}>
                  {t.toUpperCase()}
                  <span style={{marginLeft:5,fontSize:8,color:tab===key?"#009860":"#c8d8e0"}}>{n}</span>
                  {t.includes("signal")&&newSig&&<span style={{position:"absolute",top:4,right:4,width:4,height:4,borderRadius:"50%",background:"#f0c070",boxShadow:"0 0 5px #f0c070"}} className="pulse"/>}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div style={{flex:1,overflowY:"auto"}}>

            {tab==="positions"&&(
              POSITIONS.length===0?(
                <div style={{padding:"40px",textAlign:"center",color:"#8ab8c8",fontSize:11}}>No open positions yet — bot is scanning markets</div>
              ):(
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                  <thead style={{background:"#070a0d",position:"sticky",top:0,zIndex:10}}>
                    <tr>{["MARKET","ENTRY","NOW","EST.","SIZE","UNRLZD","HOLD TIME"].map(h=>(
                      <th key={h} style={{padding:"7px 10px",textAlign:"left",color:"#8ab8c8",fontSize:8,letterSpacing:".12em",fontWeight:400,borderBottom:"1px solid #0c1c28",whiteSpace:"nowrap"}}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {POSITIONS.map((p,i)=>{
                      const openedSec=p.opened_at?Math.floor((Date.now()-new Date(p.opened_at).getTime())/1000):0;
                      const totalSec=openedSec+elapsed, maxSec=24*3600;
                      const pct=Math.min(totalSec/maxSec,1), barColor=staleColor(pct), urgency=staleLabel(pct);
                      return(
                        <tr key={i} className="rh" style={{borderBottom:"1px solid #07080b"}}>
                          <td style={{padding:"10px 10px",maxWidth:200}}>
                            <span style={{color:"#ffffff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:180,display:"block"}}>{p.question}</span>
                            <div style={{fontSize:8,color:"#c8d8e0",marginTop:2}}>{p.thesis?.slice(0,52)}…</div>
                          </td>
                          <td style={{padding:"10px 10px",color:"#c8d8e0",whiteSpace:"nowrap"}}>{p.entry_price?.toFixed(3)}</td>
                          <td style={{padding:"10px 10px",color:p.current_price>p.entry_price?"#00a858":"#ff4455",whiteSpace:"nowrap"}}>{p.current_price?.toFixed(3)}</td>
                          <td style={{padding:"10px 10px",color:"#f0c070",whiteSpace:"nowrap"}}>{fmtPct(p.our_probability||0)}</td>
                          <td style={{padding:"10px 10px",color:"#ffffff",whiteSpace:"nowrap"}}>{fmt$(p.size_usd||0)}</td>
                          <td style={{padding:"10px 10px",color:(p.unrealized_pnl||0)>=0?"#00a858":"#ff4455",fontWeight:500,whiteSpace:"nowrap"}}>{sign(p.unrealized_pnl||0)}{fmt$(p.unrealized_pnl||0)}</td>
                          <td style={{padding:"10px 10px",minWidth:130}}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                              <span style={{fontSize:10,color:barColor,fontWeight:500}}>{fmtDuration(totalSec)}</span>
                              <span style={{fontSize:8,color:"#c8d8e0"}}>/24h</span>
                            </div>
                            <div style={{background:"#0d1018",height:3,borderRadius:2,overflow:"hidden",marginBottom:4}}>
                              <div className="timer-bar" style={{background:barColor,height:"100%",width:`${pct*100}%`,borderRadius:2}}/>
                            </div>
                            <div style={{display:"flex",justifyContent:"space-between"}}>
                              <span style={{fontSize:8,color:"#c8d8e0"}}>{fmtDuration(Math.max(0,maxSec-totalSec))} left</span>
                              {urgency&&<span style={{fontSize:7,color:pct>=0.9?"#ff5020":"#e08020"}}>{urgency}</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            )}

            {tab==="trades"&&(
              TRADES.length===0?(
                <div style={{padding:"40px",textAlign:"center",color:"#8ab8c8",fontSize:11}}>No closed trades yet</div>
              ):(
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                  <thead style={{background:"#070a0d",position:"sticky",top:0}}>
                    <tr>{["MARKET","ENTRY","EXIT","P&L","REASON"].map(h=>(
                      <th key={h} style={{padding:"7px 10px",textAlign:"left",color:"#8ab8c8",fontSize:8,letterSpacing:".12em",fontWeight:400,borderBottom:"1px solid #0c1c28"}}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {TRADES.map((t,i)=>(
                      <tr key={i} className="rh" style={{borderBottom:"1px solid #07080b"}}>
                        <td style={{padding:"10px 10px",color:"#ffffff",maxWidth:240}}>
                          <div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.question}</div>
                        </td>
                        <td style={{padding:"10px 10px",color:"#c8d8e0",whiteSpace:"nowrap"}}>{t.entry_price?.toFixed(2)}</td>
                        <td style={{padding:"10px 10px",color:"#ffffff",whiteSpace:"nowrap"}}>{t.exit_price?.toFixed(2)}</td>
                        <td style={{padding:"10px 10px",fontWeight:500,color:(t.pnl||0)>=0?"#00a858":"#ff4455",whiteSpace:"nowrap"}}>{sign(t.pnl||0)}{fmt$(t.pnl||0)}</td>
                        <td style={{padding:"10px 10px"}}>
                          <span style={{fontSize:8,padding:"2px 6px",borderRadius:2,letterSpacing:".1em",background:t.exit_reason==="TARGET_HIT"?"#002010":t.exit_reason==="STOP_LOSS"?"#240010":"#141400",color:t.exit_reason==="TARGET_HIT"?"#00a858":t.exit_reason==="STOP_LOSS"?"#ff4455":"#a09020"}}>
                            {t.exit_reason}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}

            {tab==="queue"&&(
              QUEUE.length===0?(
                <div style={{padding:"40px",textAlign:"center",color:"#8ab8c8",fontSize:11}}>No theses yet — run thesis_builder.py overnight</div>
              ):(
                <div style={{padding:"12px"}}>
                  {QUEUE.map((q,i)=>(
                    <div key={i} style={{background:"#0a0d12",border:"1px solid #0c1c28",borderLeft:"3px solid #007848",borderRadius:3,padding:"11px 13px",marginBottom:8}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                        <span style={{fontSize:10,color:"#ffffff"}}>{q.question}</span>
                        <span style={{fontSize:8,padding:"2px 7px",background:"#002010",color:"#00a858",borderRadius:2,letterSpacing:".1em",whiteSpace:"nowrap",marginLeft:10}}>BUY → {fmtPct(q.our_probability||0)}</span>
                      </div>
                      <div style={{display:"flex",gap:16,marginBottom:5}}>
                        <span style={{fontSize:9,color:"#c8d8e0"}}>Mkt: <span style={{color:"#ffffff"}}>{q.price?.toFixed(2)}</span></span>
                        <span style={{fontSize:9,color:"#c8d8e0"}}>Edge: <span style={{color:"#f0c070"}}>+{fmtPct(q.edge||0)}</span></span>
                        <span style={{fontSize:9,color:"#c8d8e0"}}>Conf: <span style={{color:"#00a858"}}>{q.confidence}</span></span>
                      </div>
                      <div style={{fontSize:9,color:"#c8d8e0",fontStyle:"italic"}}>"{q.thesis}"</div>
                    </div>
                  ))}
                </div>
              )
            )}

            {tab==="signals"&&(
              <div style={{padding:"12px"}}>
                {signals.length===0?(
                  <div style={{padding:"40px",textAlign:"center",color:"#8ab8c8",fontSize:11}}>No whale signals yet</div>
                ):signals.map((s,i)=>(
                  <div key={i} className={i===0?"slidein":""} style={{background:"#09090d",border:`1px solid ${s.action==="FOLLOWED"?TC[s.tier]+"22":"#1c1010"}`,borderLeft:`3px solid ${s.action==="FOLLOWED"?TC[s.tier]:"#3a1818"}`,borderRadius:3,padding:"10px 12px",marginBottom:7,opacity:s.action==="SKIPPED"?0.6:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                      <TierBadge tier={s.tier}/>
                      <span style={{fontSize:9,color:"#c8d8e0",flex:1}}>{s.wallet}</span>
                      <span style={{fontSize:8,padding:"2px 6px",borderRadius:2,letterSpacing:".1em",background:s.action==="FOLLOWED"?"#001a0e":"#1c0808",color:s.action==="FOLLOWED"?"#00a858":"#ff4455"}}>{s.action}</span>
                      {s.action==="FOLLOWED"&&<span style={{fontSize:8,padding:"2px 6px",background:"#08182a",color:"#80c8e0",borderRadius:2}}>KELLY {s.kelly}</span>}
                    </div>
                    <div style={{fontSize:10,color:"#ffffff",marginBottom:6}}>{s.question}</div>
                    <div style={{display:"flex",alignItems:"center",gap:14}}>
                      <span style={{fontSize:9,color:"#c8d8e0"}}>Entry: <span style={{color:"#ffffff"}}>{s.entry_price?.toFixed(3)}</span></span>
                      <span style={{fontSize:9,color:"#c8d8e0"}}>Size: <span style={{color:"#f0c070"}}>{fmtK(s.size_usd||0)}</span></span>
                      {s.has_thesis?<span style={{fontSize:8,color:"#009050",background:"#001408",padding:"1px 6px",borderRadius:2}}>✓ THESIS</span>:<span style={{fontSize:8,color:"#c8d8e0",background:"#0c0e12",padding:"1px 6px",borderRadius:2}}>no thesis</span>}
                      <div style={{flex:1}}/>
                      <span style={{fontSize:8,color:"#c8d8e0"}}>{s.detected_at}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{background:"#070a0d",borderLeft:"1px solid #0c1c28",display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{display:"flex",borderBottom:"1px solid #0c1c28",flexShrink:0}}>
            {["leaderboard","stats"].map(t=>(
              <button key={t} className="tb" onClick={()=>setWTab(t)} style={{flex:1,padding:"9px 0",fontSize:8,letterSpacing:".14em",color:wTab===t?"#f0c070":"#8ab8c8",borderBottom:wTab===t?"2px solid #f0c070":"2px solid transparent",marginBottom:-1,transition:"color .15s"}}>
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          <div style={{flex:1,overflowY:"auto",padding:"10px"}}>
            {wTab==="leaderboard"&&(
              <>
                <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".18em",marginBottom:10}}>TRACKED WALLETS · {WHALES.length} TOTAL</div>
                {WHALES.map((w,i)=>(
                  <div key={i} style={{background:"#09090e",border:"1px solid #0c1820",borderRadius:3,padding:"9px 10px",marginBottom:7}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                      <div style={{width:5,height:5,borderRadius:"50%",background:w.active?"#00ff8c":"#8ab8c8",boxShadow:w.active?"0 0 5px #00ff8c":"none"}} className={w.active?"pulse":""}/>
                      <span style={{fontSize:9,color:"#c8d8e0",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{w.address}</span>
                      <TierBadge tier={w.tier}/>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,marginBottom:7}}>
                      {[["WIN RATE",fmtPct(w.win_rate),"#00a858"],["TOTAL PnL",fmtK(w.total_pnl),"#f0c070"],["TRADES",w.total_trades,"#80c8e0"]].map(([l,v,c])=>(
                        <div key={l}>
                          <div style={{fontSize:7,color:"#8ab8c8",letterSpacing:".1em",marginBottom:2}}>{l}</div>
                          <div style={{fontSize:12,color:c,fontWeight:500}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                      <CatBadge cat={w.best_category}/>
                      <span style={{fontSize:8,color:"#c8d8e0"}}>wt {fmtPct(w.signal_weight)}</span>
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
                <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".18em",marginBottom:10}}>LIVE PERFORMANCE</div>
                {[
                  {l:"BALANCE",        v:fmt$(portfolio.balance),c:"#ffffff",big:true},
                  {l:"TODAY P&L",      v:`${sign(portfolio.daily_pnl)}${fmt$(portfolio.daily_pnl)}`,c:portfolio.daily_pnl>=0?"#00ff8c":"#ff4455",big:true},
                  {l:"WIN RATE",       v:fmtPct(portfolio.win_rate),c:"#f0c070"},
                  {l:"TOTAL TRADES",   v:`${portfolio.total_trades}`,c:"#80c8e0"},
                  {l:"OPEN POSITIONS", v:`${portfolio.open_positions}`,c:"#ffffff"},
                  {l:"DRAWDOWN",       v:fmtPct(portfolio.drawdown_pct),c:"#c8d8e0"},
                  {l:"MODE",           v:portfolio.paper_trading?"PAPER TRADING":"LIVE TRADING",c:portfolio.paper_trading?"#f0c070":"#00ff8c"},
                ].map(({l,v,c,big})=>(
                  <div key={l} style={{padding:"7px 0",borderBottom:"1px solid #08090c"}}>
                    <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".14em",marginBottom:3}}>{l}</div>
                    <div style={{fontSize:big?18:13,color:c,fontWeight:big?500:400}}>{v}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
