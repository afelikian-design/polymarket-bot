import { useState, useEffect, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const API_BASE = "https://api.feliksbot.com";

const TIMEFRAMES = [
  { label: "1H",  points: 12,  interval: 5  },
  { label: "6H",  points: 24,  interval: 15 },
  { label: "24H", points: 96,  interval: 15 },
  { label: "7D",  points: 168, interval: 60 },
  { label: "ALL", points: 240, interval: 60 },
];

const generatePnL = () => {
  return [{ time: "now", balance: 1000 }];
};

const WHALES = [
  { address: "0x24c8cf69a0e0a17eee21f69d29752bfa32e823e1", name: "debased",      tier: 1, win_rate: 0.74, total_pnl: 843100, total_trades: 399,  best_category: "macro",    signal_weight: 1.0,  active: true,  recent: [] },
  { address: "0x6bab41a0dc40d6dd4c1a915b8c01969479fd1292", name: "Dropper",      tier: 1, win_rate: 0.72, total_pnl: 316900, total_trades: 156,  best_category: "politics", signal_weight: 1.0,  active: true,  recent: [] },
  { address: "0x000d257d2dc7616feaef4ae0f14600fdf50a758e", name: "scottilicious", tier: 1, win_rate: 0.82, total_pnl: 174300, total_trades: 150,  best_category: "crypto",   signal_weight: 1.0,  active: true,  recent: [] },
  { address: "0x06dcaa14f57d8a0573f5dc5940565e6de667af59", name: "Big.Chungus",  tier: 1, win_rate: 0.70, total_pnl: 104200, total_trades: 245,  best_category: "other",    signal_weight: 1.0,  active: true,  recent: [] },
  { address: "0x011f2d377e56119fb09196dffb0948ae55711122", name: "11122",         tier: 2, win_rate: 0.63, total_pnl: 244500, total_trades: 699,  best_category: "politics", signal_weight: 0.75, active: false, recent: [] },
  { address: "0xd5ccdf772f795547e299de57f47966e24de8dea4", name: "tsybka",        tier: 2, win_rate: 0.86, total_pnl: 78200,  total_trades: 155,  best_category: "macro",    signal_weight: 0.75, active: true,  recent: [] },
  { address: "0x751a2b86cab503496efd325c8344e10159349ea1", name: "Sharky6999",   tier: 2, win_rate: 0.98, total_pnl: 31300,  total_trades: 2750, best_category: "crypto",   signal_weight: 0.75, active: true,  recent: [] },
  { address: "0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397", name: "aviato",       tier: 2, win_rate: 0.91, total_pnl: 29800,  total_trades: 288,  best_category: "politics", signal_weight: 0.75, active: true,  recent: [] },
];

const fmt$   = n => `${n<0?"-":""}$${Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtK   = n => n>=1000?`$${(n/1000).toFixed(1)}K`:fmt$(n);
const fmtPct = n => `${n<0?"-":""}${Math.abs(n*100).toFixed(1)}%`;
const sign   = n => n>=0?"+":"";

const TC = {1:"#f0c070",2:"#80c8e0",3:"#607888"};
const TB = {1:"#1e1000",2:"#001222",3:"#0e1218"};
const TL = {1:"ELITE",2:"STRONG",3:"WATCH"};
const CC = {macro:"#a080f0",politics:"#e07888",crypto:"#00c8a0",other:"#5a7080"};
const ET = {
  SCANNING:   {color:"#80c8e0",icon:"⟳",label:"SCAN"},
  EVALUATING: {color:"#a080f0",icon:"◈",label:"EVAL"},
  THESIS:     {color:"#00ff8c",icon:"✦",label:"THESIS"},
  TRADE:      {color:"#f0c070",icon:"◆",label:"TRADE"},
  EXIT:       {color:"#e07888",icon:"✕",label:"EXIT"},
  SKIP:       {color:"#4a5868",icon:"–",label:"SKIP"},
  ERROR:      {color:"#ff4455",icon:"!",label:"ERROR"},
};

const TierBadge = ({tier}) => (
  <span style={{fontSize:6,padding:"1px 4px",borderRadius:2,letterSpacing:".12em",background:TB[tier],color:TC[tier],border:`1px solid ${TC[tier]}28`,fontWeight:700}}>
    T{tier} {TL[tier]}
  </span>
);
const CatBadge = ({cat}) => (
  <span style={{fontSize:6,padding:"1px 4px",borderRadius:2,letterSpacing:".1em",color:CC[cat]||"#5a7080",background:(CC[cat]||"#5a7080")+"18"}}>
    {cat?.toUpperCase()}
  </span>
);

function WhaleCard({w}) {
  return (
    <div style={{padding:"3px 6px",border:"1px solid #0c1e2a",borderRadius:3,marginBottom:2,background:"#080b0e"}}>
      <div style={{display:"flex",alignItems:"center",gap:4}}>
        <div style={{width:4,height:4,borderRadius:"50%",flexShrink:0,background:w.active?"#00ff8c":"#1e3040",boxShadow:w.active?"0 0 3px #00ff8c":"none"}}/>
        <span style={{fontSize:7,color:"#c8d8e0",fontWeight:600,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{w.name||w.address.slice(0,8)}</span>
        <CatBadge cat={w.best_category}/>
      </div>
      <div style={{display:"flex",gap:8,paddingLeft:9,marginTop:1}}>
        <span style={{fontSize:6,color:"#00a858"}}>{fmtPct(w.win_rate)}</span>
        <span style={{fontSize:6,color:"#f0c070"}}>{fmtK(w.total_pnl)}</span>
        <span style={{fontSize:6,color:"#80c8e0"}}>{w.total_trades}t</span>
      </div>
    </div>
  );
}
// Bottom nav icons
const NAV_ITEMS = [
  {key:"overview", icon:"◈", label:"Overview"},
  {key:"positions",icon:"◆", label:"Positions"},
  {key:"trades",   icon:"↕", label:"Trades"},
  {key:"activity", icon:"⟳", label:"Activity"},
  {key:"whales",   icon:"🐋",label:"Whales"},
];

export default function Dashboard() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [tfIdx, setTfIdx]       = useState(2);
  const [pnlData, setPnlData]   = useState(() => generatePnL(96, 15));
  const [allSnaps, setAllSnaps] = useState([]);
  const tfIdxRef = useRef(2);
  const [mobileTab, setMobileTab] = useState("overview");
  const [desktopTab, setDesktopTab] = useState("positions");
  const [wTab, setWTab]         = useState("leaderboard");
  const [elapsed, setElapsed]   = useState(0);
  const [apiError, setApiError] = useState(false);
  const [expandedWhale, setExpandedWhale] = useState(null);
  const [expandedAgent, setExpandedAgent] = useState(false);
  const activityRef = useRef(null);

  const [portfolio, setPortfolio] = useState({balance:1000,daily_pnl:0,win_rate:0,open_positions:0,drawdown_pct:0,total_trades:0,paper_trading:true});
  const [POSITIONS, setPositions] = useState([]);
  const [TRADES, setTrades]       = useState([]);
  const [QUEUE, setQueue]         = useState([]);
  const [agentData, setAgentData] = useState({
    no_bot:{status:"idle",message:"Starting..."},
    binance_bot:{status:"idle",message:"Starting..."},
    copy_bot:{status:"idle",message:"Starting..."},
  });
  const [activity, setActivity]   = useState([]);
  const [insights, setInsights]   = useState(null);
  const [categoryStats, setCategoryStats] = useState([]);
  const [whaleTrades, setWhaleTrades] = useState([]);
  const [showRealized, setShowRealized] = useState(false);
  const [prevActivityId, setPrevActivityId] = useState(null);
  const [newActivity, setNewActivity] = useState(false);

  useEffect(()=>{
    const handle = ()=>setIsMobile(window.innerWidth<768);
    window.addEventListener("resize",handle);
    return()=>window.removeEventListener("resize",handle);
  },[]);

  useEffect(()=>{
    const fetchData = async () => {
      try {
        const [port,pos,trd,agt,queue,snaps,insights,catStats,wt] = await Promise.all([
          fetch(`${API_BASE}/api/portfolio`).then(r=>r.json()),
          fetch(`${API_BASE}/api/positions`).then(r=>r.json()),
          fetch(`${API_BASE}/api/trades`).then(r=>r.json()),
          fetch(`${API_BASE}/api/agents`).then(r=>r.json()),
          fetch(`${API_BASE}/api/queue`).then(r=>r.json()),
          fetch(`${API_BASE}/api/snapshots`).then(r=>r.json()),
          fetch(`${API_BASE}/api/insights`).then(r=>r.json()).catch(()=>null),
          fetch(`${API_BASE}/api/category_stats`).then(r=>r.json()).catch(()=>[]),
          fetch(`${API_BASE}/api/whale_trades`).then(r=>r.json()).catch(()=>[]),
        ]);
        setPortfolio(port); setPositions(pos); setTrades(trd); setAgentData(agt); setQueue(queue);
        if(wt) setWhaleTrades(wt);
        if(snaps && snaps.length > 0){
          setAllSnaps(snaps);
          const tf = TIMEFRAMES[tfIdxRef.current];
          const now = Date.now();
          const cutoff = tf.label === "ALL" ? 0 : now - tf.points * tf.interval * 60 * 1000;
          const filtered = snaps.filter(s => tf.label === "ALL" || new Date(s.time).getTime() >= cutoff);
          const src = filtered.length > 0 ? filtered : snaps;
          const chartData = src.map(s=>({
            time: new Date(s.time).toLocaleTimeString("en-US",{timeZone:"America/Los_Angeles",hour:"2-digit",minute:"2-digit"}),
            balance: s.balance + (s.open_pnl||0),
            realized: s.balance
          }));
          setPnlData(chartData);
        }
        if(insights) setInsights(insights);
        if(catStats && catStats.length > 0) setCategoryStats(catStats);
        setApiError(false);
      } catch(e){ setApiError(true); }
    };
    fetchData();
    const interval = setInterval(fetchData,5000);
    return()=>clearInterval(interval);
  },[]);

  useEffect(()=>{
    const fetchActivity = async () => {
      try {
        const data = await fetch(`${API_BASE}/api/activity`).then(r=>r.json());
        if(data.length>0){
          setActivity(prev => {
            if(prev.length===0||data[0].id!==prev[0].id){
              setNewActivity(true);
              setPrevActivityId(data[0].id);
              setTimeout(()=>setNewActivity(false),1200);
            }
            return data;
          });
        }
      } catch(e){}
    };
    fetchActivity();
    const interval = setInterval(fetchActivity,5000);
    return()=>clearInterval(interval);
  },[]);

  useEffect(()=>{const t=setInterval(()=>setElapsed(e=>e+1),1000);return()=>clearInterval(t);},[]);

  const switchTf = (i) => {
    setTfIdx(i);
    tfIdxRef.current = i;
    const tf = TIMEFRAMES[i];
    const now = Date.now();
    const cutoff = tf.label === "ALL" ? 0 : now - tf.points * tf.interval * 60 * 1000;
    const snaps = allSnaps.length > 0 ? allSnaps : [];
    const filtered = snaps.filter(s => tf.label === "ALL" || new Date(s.time).getTime() >= cutoff);
    const src = filtered.length > 0 ? filtered : snaps;
    if (src.length > 0) {
      const chartData = src.map(s => ({
        time: new Date(s.time).toLocaleTimeString("en-US", {
          timeZone: "America/Los_Angeles",
          hour: "2-digit", minute: "2-digit",
        }),
        balance: s.balance + (s.open_pnl || 0),
        realized: s.balance
      }));
      setPnlData(chartData);
    }
  };
  const chartKey = showRealized ? "realized" : "balance";
  const p0=pnlData[0]?.[chartKey]??1000, pN=pnlData[pnlData.length-1]?.[chartKey]??1000, pd=pN-p0;

  // ── MOBILE LAYOUT ─────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{background:"#07090c",minHeight:"100vh",fontFamily:"'DM Mono',monospace",color:"#fff",display:"flex",flexDirection:"column"}}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');
          *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
          ::-webkit-scrollbar{display:none}
          .pulse{animation:pulse 2s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
          .blink{animation:blink 1.2s step-end infinite}@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
          .mob-card{background:#0a0d12;border:1px solid #0c1820;border-radius:10px;padding:14px;margin-bottom:10px}
          .mob-btn{background:none;border:none;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent}
          .tf-btn{background:none;border:none;cursor:pointer;font-family:inherit;padding:5px 10px;font-size:10px;border-radius:4px;transition:all .15s}
          .nav-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 0;background:none;border:none;cursor:pointer;font-family:inherit}
          .flashrow{animation:fl .8s ease}@keyframes fl{0%{background:rgba(0,255,140,.1)}100%{background:transparent}}
        `}</style>

        {/* MOBILE HEADER */}
        <div style={{background:"#070a0d",borderBottom:"1px solid #0c1c28",padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:apiError?"#ff4455":"#00ff8c",boxShadow:apiError?"0 0 8px #ff4455":"0 0 8px #00ff8c"}} className="pulse"/>
            <span style={{fontWeight:500,fontSize:15,color:"#00ff8c",letterSpacing:".12em"}}>POLYBOT</span>
            <span style={{fontSize:10,color:"#f0c070",letterSpacing:".1em",background:"#1e1000",padding:"2px 7px",borderRadius:3}}>{portfolio.paper_trading?"PAPER":"LIVE"}</span>
          </div>
          <span style={{fontSize:10,color:"#8ab8c8"}}>{new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})} <span className="blink">_</span></span>
        </div>

        {/* MOBILE CONTENT */}
        <div style={{flex:1,overflowY:"auto",padding:"12px 14px",paddingBottom:80}}>

          {/* OVERVIEW TAB */}
          {mobileTab==="overview" && (
            <div>
              {/* Balance card */}
              <div className="mob-card" style={{textAlign:"center",marginBottom:10}}>
                <div style={{fontSize:11,color:"#8ab8c8",letterSpacing:".16em",marginBottom:4}}>BALANCE</div>
                <div style={{fontSize:36,fontWeight:500,color:"#ffffff",marginBottom:4}}>{fmt$(portfolio.balance)}</div>
                <div style={{fontSize:14,color:portfolio.daily_pnl>=0?"#00ff8c":"#ff4455"}}>
                  {sign(portfolio.daily_pnl)}{fmt$(portfolio.daily_pnl)} today
                </div>
              </div>

              {/* Stats row */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
                {[["WIN RATE",fmtPct(portfolio.win_rate),"#f0c070"],["TRADES",portfolio.total_trades,"#80c8e0"],["DRAWDOWN",fmtPct(portfolio.drawdown_pct),"#c8d8e0"]].map(([l,v,c])=>(
                  <div key={l} className="mob-card" style={{padding:"10px",textAlign:"center",marginBottom:0}}>
                    <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".1em",marginBottom:4}}>{l}</div>
                    <div style={{fontSize:16,color:c,fontWeight:500}}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Chart */}
              <div className="mob-card">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <span style={{fontSize:10,color:"#8ab8c8",letterSpacing:".14em"}}>PORTFOLIO</span>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:12,color:(showRealized?portfolio.daily_pnl:(portfolio.open_pnl||0))>=0?"#00ff8c":"#ff4455",fontWeight:500}}>{sign(showRealized?portfolio.daily_pnl:(portfolio.open_pnl||0))}{fmt$(Math.abs(showRealized?portfolio.daily_pnl:(portfolio.open_pnl||0)))}</span>
                    <button onClick={()=>setShowRealized(r=>!r)} style={{fontSize:7,padding:"2px 6px",borderRadius:3,background:showRealized?"#0a1e14":"#0a0d12",border:showRealized?"1px solid #00ff8c44":"1px solid #1a2a38",color:showRealized?"#00ff8c":"#4a6070",cursor:"pointer"}}>{showRealized?"REALIZED":"TOTAL"}</button>
                  </div>
                </div>
                {/* Timeframe toggles */}
                <div style={{display:"flex",gap:4,marginBottom:10,background:"#07090c",borderRadius:6,padding:3}}>
                  {TIMEFRAMES.map((t,i)=>(
                    <button key={t.label} className="tf-btn" onClick={()=>switchTf(i)} style={{flex:1,color:tfIdx===i?"#00ff8c":"#4a6070",background:tfIdx===i?"#0a1e14":"none",border:tfIdx===i?"1px solid #00ff8c22":"1px solid transparent",fontWeight:tfIdx===i?500:400}}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={pnlData} margin={{top:2,right:2,bottom:0,left:0}}>
                    <defs>
                      <linearGradient id="lg" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#006840"/><stop offset="100%" stopColor="#00ff8c"/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="time" tick={{fill:"#8ab8c8",fontSize:8}} axisLine={false} tickLine={false} interval={Math.floor(pnlData.length/4)}/>
                    <YAxis tick={{fill:"#8ab8c8",fontSize:8}} axisLine={false} tickLine={false} width={40} tickFormatter={v=>`$${v.toFixed(0)}`} domain={["auto","auto"]}/>
                    <Tooltip contentStyle={{background:"#0b0e14",border:"1px solid #0c1c28",borderRadius:6,fontSize:11}} formatter={v=>[fmt$(v),"Balance"]}/>
                    <ReferenceLine y={p0} stroke="#8ab8c8" strokeDasharray="3 3"/>
                    <Line type="monotone" dataKey={chartKey} stroke="url(#lg)" strokeWidth={2} dot={false} activeDot={{r:4,fill:"#00ff8c"}}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Agent status */}
              <div className="mob-card">
                <button className="mob-btn" onClick={()=>setExpandedAgent(!expandedAgent)} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:expandedAgent?10:0}}>
                  <span style={{fontSize:10,color:"#8ab8c8",letterSpacing:".14em"}}>AGENTS</span>
                  <span style={{fontSize:10,color:"#304858"}}>{expandedAgent?"▲":"▼"}</span>
                </button>
                {expandedAgent && Object.entries(agentData).map(([name,a])=>(
                  <div key={name} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"8px 0",borderBottom:"1px solid #0c1820"}}>
                    <div>
                      <div style={{fontSize:10,color:"#ffffff",marginBottom:2}}>{name.replace(/_/g," ").toUpperCase()}</div>
                      <div style={{fontSize:10,color:"#c8d8e0",lineHeight:1.4,maxWidth:220}}>{a.message}</div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:a.status==="running"?"#00ff8c":a.status==="error"?"#ff4455":"#8ab8c8",boxShadow:a.status==="running"?"0 0 5px #00ff8c":"none"}} className={a.status==="running"?"pulse":""}/>
                      <span style={{fontSize:9,color:a.status==="running"?"#00cc70":a.status==="error"?"#ff4455":"#c8d8e0"}}>{a.status?.toUpperCase()}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Category Exposure */}
              <div className="mob-card">
                <div style={{fontSize:10,color:"#8ab8c8",letterSpacing:".14em",marginBottom:8}}>EXPOSURE BY CATEGORY</div>
                {[
                  {cat:"CRYPTO",  color:"#0088ff", pct: POSITIONS.filter(p=>["bitcoin","eth","sol","crypto","btc","ethereum","solana","xrp","up or down"].some(k=>p.question?.toLowerCase().includes(k))).length / Math.max(POSITIONS.length,1)},
                  {cat:"SPORTS",  color:"#aa66ff", pct: POSITIONS.filter(p=>["blazers","spurs","lakers","celtics","nba","nfl","nhl","mlb","vs.","o/u","rebounds","goals"].some(k=>p.question?.toLowerCase().includes(k))).length / Math.max(POSITIONS.length,1)},
                  {cat:"POLITICS",color:"#00cc66", pct: POSITIONS.filter(p=>["trump","biden","election","iran","diplomatic","senate","tariff","minister","vote"].some(k=>p.question?.toLowerCase().includes(k))).length / Math.max(POSITIONS.length,1)},
                  {cat:"MACRO",   color:"#f0c070", pct: POSITIONS.filter(p=>["fed","rate","inflation","strait","hormuz","ships","transit","oil","gold","bond","gdp"].some(k=>p.question?.toLowerCase().includes(k))).length / Math.max(POSITIONS.length,1)},
                  {cat:"ESPORTS", color:"#ff6644", pct: POSITIONS.filter(p=>["lol:","valorant","csgo","gen.g","lck","bo3","mobile legends"].some(k=>p.question?.toLowerCase().includes(k))).length / Math.max(POSITIONS.length,1)},
                ].map(({cat,color,pct})=>(
                  <div key={cat} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                    <span style={{fontSize:9,color:"#6a9090",width:56,flexShrink:0}}>{cat}</span>
                    <div style={{flex:1,height:4,background:"#0c1c28",borderRadius:2}}>
                      <div style={{width:`${Math.round(pct*100)}%`,height:4,background:color,borderRadius:2}}/>
                    </div>
                    <span style={{fontSize:9,color:color,width:28,textAlign:"right",flexShrink:0}}>{Math.round(pct*100)}%</span>
                  </div>
                ))}
              </div>

              {/* Risk engine */}
              <div className="mob-card">
                <div style={{fontSize:10,color:"#8ab8c8",letterSpacing:".14em",marginBottom:8}}>RISK ENGINE</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  {[["Kelly Cap","10%"],["Daily Loss","−10%"],["Max Draw","−20%"],["Open Pos",`${portfolio.open_positions}/20`]].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 10px",background:"#07090c",borderRadius:6,border:"1px solid #0c1820"}}>
                      <span style={{fontSize:9,color:"#8ab8c8"}}>{l}</span>
                      <span style={{fontSize:11,fontWeight:700,color:v.startsWith("−")||v.startsWith("-")?"#ff4455":v.includes("/")?"#80c8e0":"#00ff8c"}}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Strategy Intelligence */}
              {insights&&(
                <div className="mob-card">
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <span style={{fontSize:10,color:"#8ab8c8",letterSpacing:".14em"}}>STRATEGY INTELLIGENCE</span>
                    <div style={{textAlign:"right"}}>
                      {insights.analyzed_at&&<div style={{fontSize:7,color:"#4a6070"}}>{new Date(insights.analyzed_at).toLocaleTimeString("en-US",{timeZone:"America/Los_Angeles",hour:"2-digit",minute:"2-digit"})}</div>}
                      {insights.analyzed_at&&<div style={{fontSize:7,color:"#304858"}}>Next: {new Date(new Date(insights.analyzed_at).getTime()+12*60*60*1000).toLocaleTimeString("en-US",{timeZone:"America/Los_Angeles",hour:"2-digit",minute:"2-digit"})}</div>}
                    </div>
                  </div>
                  <div style={{fontSize:10,color:"#8ab8c8",lineHeight:1.5,marginBottom:8}}>{insights.summary}</div>
                  {(insights.warnings||[]).map((w,i)=>(
                    <div key={i} style={{display:"flex",gap:6,marginBottom:4}}>
                      <span style={{color:"#ff4455",fontSize:10,flexShrink:0}}>⚠</span>
                      <span style={{fontSize:10,color:"#ff6070",lineHeight:1.4}}>{w}</span>
                    </div>
                  ))}
                  {(insights.recommendations||[]).map((r,i)=>(
                    <div key={i} style={{display:"flex",gap:6,marginBottom:4}}>
                      <span style={{color:"#00a858",fontSize:10,flexShrink:0}}>⚡</span>
                      <span style={{fontSize:10,color:"#00c86e",lineHeight:1.4}}>{r}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* POSITIONS TAB */}
          {mobileTab==="positions" && (
            <div>
              <div style={{fontSize:10,color:"#8ab8c8",letterSpacing:".14em",marginBottom:12}}>OPEN POSITIONS · {POSITIONS.length}</div>
              {POSITIONS.length===0?(
                <div className="mob-card" style={{textAlign:"center",color:"#8ab8c8",fontSize:12,padding:"32px 14px"}}>
                  No open positions — bot is scanning markets
                </div>
              ):POSITIONS.map((p,i)=>(
                <div key={i} className="mob-card">
                  <div style={{fontSize:12,color:"#ffffff",marginBottom:6,lineHeight:1.4}}>{p.question}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                    {[["ENTRY",p.entry_price?.toFixed(3),"#c8d8e0"],["NOW",p.current_price?.toFixed(3),p.current_price>p.entry_price?"#00a858":"#ff4455"],["EST.",fmtPct(p.our_probability||0),"#f0c070"]].map(([l,v,c])=>(
                      <div key={l}>
                        <div style={{fontSize:9,color:"#8ab8c8",marginBottom:2}}>{l}</div>
                        <div style={{fontSize:14,color:c,fontWeight:500}}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:11,color:"#8ab8c8"}}>Size: <span style={{color:"#fff"}}>{fmt$(p.size_usd||0)}</span></span>
                    <span style={{fontSize:13,fontWeight:500,color:(p.unrealized_pnl||0)>=0?"#00a858":"#ff4455"}}>{sign(p.unrealized_pnl||0)}{fmt$(p.unrealized_pnl||0)}</span>
                  </div>
                  {p.thesis && <div style={{fontSize:10,color:"#8ab8c8",marginTop:6,fontStyle:"italic",lineHeight:1.4}}>"{p.thesis?.slice(0,80)}"</div>}
                </div>
              ))}

              {/* Queue */}
              {QUEUE.length>0 && (
                <>
                  <div style={{fontSize:10,color:"#8ab8c8",letterSpacing:".14em",margin:"16px 0 10px"}}>PENDING THESES · {QUEUE.length}</div>
                  {QUEUE.map((q,i)=>(
                    <div key={i} className="mob-card" style={{borderLeft:"3px solid #007848"}}>
                      <div style={{fontSize:12,color:"#ffffff",marginBottom:6,lineHeight:1.4}}>{q.question}</div>
                      <div style={{display:"flex",gap:12,marginBottom:6}}>
                        <span style={{fontSize:10,color:"#8ab8c8"}}>Mkt: <span style={{color:"#fff"}}>{q.price?.toFixed(2)}</span></span>
                        <span style={{fontSize:10,color:"#8ab8c8"}}>Edge: <span style={{color:"#f0c070"}}>+{fmtPct(q.edge||0)}</span></span>
                        <span style={{fontSize:10,color:"#8ab8c8"}}>Conf: <span style={{color:"#00a858"}}>{q.confidence}</span></span>
                        <span style={{fontSize:10,color:"#8ab8c8"}}>Bet: <span style={{color:"#f0c070"}}>{fmt$(q.suggested_size||0)}</span></span>
                      </div>
                      <div style={{fontSize:10,color:"#8ab8c8",fontStyle:"italic"}}>"{q.thesis}"</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* TRADES TAB */}
          {mobileTab==="trades" && (
            <div>
              <div style={{fontSize:10,color:"#8ab8c8",letterSpacing:".14em",marginBottom:12}}>CLOSED TRADES · {TRADES.length}</div>
              {TRADES.length===0?(
                <div className="mob-card" style={{textAlign:"center",color:"#8ab8c8",fontSize:12,padding:"32px 14px"}}>No closed trades yet</div>
              ):TRADES.map((t,i)=>(
                <div key={i} className="mob-card">
                  <div style={{fontSize:12,color:"#ffffff",marginBottom:6,lineHeight:1.4}}>{t.question}</div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                    <div style={{display:"flex",gap:10}}>
                      <span style={{fontSize:11,color:"#8ab8c8"}}>In: <span style={{color:"#fff"}}>{t.entry_price?.toFixed(3)}</span></span>
                      <span style={{fontSize:11,color:"#8ab8c8"}}>Out: <span style={{color:"#fff"}}>{t.exit_price?.toFixed(3)}</span></span>
                    </div>
                    <span style={{fontSize:15,fontWeight:500,color:(t.pnl||0)>=0?"#00a858":"#ff4455"}}>{sign(t.pnl||0)}{fmt$(t.pnl||0)}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                    <div style={{display:"flex",gap:8}}>
                      {t.opened_at&&<span style={{fontSize:9,color:"#4a6070"}}>Opened: <span style={{color:"#8ab8c8"}}>{new Date(t.opened_at.endsWith("Z")?t.opened_at:t.opened_at+"Z").toLocaleString("en-US",{timeZone:"America/Los_Angeles",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}</span></span>}
                      {t.closed_at&&<span style={{fontSize:9,color:"#4a6070"}}>Closed: <span style={{color:"#8ab8c8"}}>{new Date(t.closed_at.endsWith("Z")?t.closed_at:t.closed_at+"Z").toLocaleString("en-US",{timeZone:"America/Los_Angeles",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}</span></span>}
                    </div>
                  </div>
                  <span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:t.exit_reason==="TARGET_HIT"?"#002010":t.exit_reason==="STOP_LOSS"?"#240010":"#141400",color:t.exit_reason==="TARGET_HIT"?"#00a858":t.exit_reason==="STOP_LOSS"?"#ff4455":"#a09020"}}>
                    {t.exit_reason}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* ACTIVITY TAB */}
          {mobileTab==="activity" && (
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                <div style={{width:7,height:7,borderRadius:"50%",background:newActivity?"#00ff8c":"#304858",boxShadow:newActivity?"0 0 7px #00ff8c":"none"}} className={newActivity?"pulse":""}/>
                <span style={{fontSize:10,color:"#8ab8c8",letterSpacing:".14em"}}>CLAUDE ACTIVITY · live</span>
              </div>
              {activity.length===0?(
                <div className="mob-card" style={{textAlign:"center",color:"#8ab8c8",fontSize:12,padding:"32px 14px"}}>Waiting for activity...</div>
              ):activity.map((log,i)=>{
                const et=ET[log.event_type]||ET.SCANNING;
                return(
                  <div key={log.id} className={`mob-card ${i===0&&newActivity?"flashrow":""}`} style={{padding:"10px 12px",marginBottom:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:log.market?4:0}}>
                      <span style={{fontSize:6,padding:"1px 4px",borderRadius:3,background:et.color+"18",color:et.color,flexShrink:0}}>{et.icon} {et.label}</span>
                      <span style={{fontSize:9,color:"#4a7080",flexShrink:0}}>{log.agent?.replace(/_/g,"·")}</span>
                      <div style={{flex:1}}/>
                      <span style={{fontSize:9,color:"#243848"}}>{log.time_ago}</span>
                    </div>
                    {log.market&&<div style={{fontSize:10,color:"#8ab8c8",marginBottom:3,lineHeight:1.4}}>{log.market}</div>}
                    <div style={{fontSize:11,color:et.color==="#4a5868"?"#506070":"#c8d8e0",lineHeight:1.5}}>{log.message}</div>
                    {log.detail&&<div style={{fontSize:10,color:"#4a6070",marginTop:3,lineHeight:1.4}}>{log.detail}</div>}
                  </div>
                );
              })}
            </div>
          )}

          {/* WHALES TAB */}
          {mobileTab==="whales" && (
            <div>
              <div style={{fontSize:10,color:"#8ab8c8",letterSpacing:".14em",marginBottom:12}}>
                {WHALES.length} TRACKED WALLETS · TAP TO SEE TRADES
              </div>
              {WHALES.map((w,i)=>(
                <WhaleCard key={i} w={w} expanded={expandedWhale===i} onToggle={()=>setExpandedWhale(expandedWhale===i?null:i)}/>
              ))}
              <div style={{marginTop:16,marginBottom:6,fontSize:9,color:"#8ab8c8",letterSpacing:".18em"}}>RECENT WHALE TRADES · LIVE</div>
              {whaleTrades.slice(0,20).map((t,i)=>(
                <details key={i} style={{borderBottom:"1px solid #0a0c10",padding:"4px 0",cursor:"pointer"}}>
                  <summary style={{listStyle:"none",outline:"none"}}>
                    <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:1}}>
                      <span style={{fontSize:6,padding:"1px 4px",borderRadius:2,background:t.side==="BUY"?"#002010":"#200010",color:t.side==="BUY"?"#00a858":"#ff4455",flexShrink:0,fontWeight:600}}>{t.side}</span>
                      <span style={{fontSize:7,color:"#f0c070",flexShrink:0,fontWeight:600}}>{t.name}</span>
                      <span style={{fontSize:7,color:"#8ab8c8",flexShrink:0}}>${(Number(t.size)||0).toFixed(0)}</span>
                      <span style={{fontSize:6,color:"#4a7080",flexShrink:0}}>@{(Number(t.price)||0).toFixed(3)}</span>
                      <span style={{fontSize:7,color:"#8ab8c8",flexShrink:0,marginLeft:"auto",whiteSpace:"nowrap"}}>{t.timestamp?new Date(Number(t.timestamp)*1000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"—"}</span>
                    </div>
                    <div style={{fontSize:6,color:"#c8d8e0",paddingLeft:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.market}</div>
                  </summary>
                  <div style={{padding:"4px",marginTop:2,background:"#060809",borderRadius:2}}>
                    <div style={{fontSize:7,color:"#c8d8e0",lineHeight:1.5,wordBreak:"break-word"}}>{t.market}</div>
                    <div style={{display:"flex",gap:8,marginTop:3,flexWrap:"wrap"}}>
                      <span style={{fontSize:6,color:"#4a7080"}}>Outcome: <span style={{color:"#c8d8e0"}}>{t.outcome||"—"}</span></span>
                      <span style={{fontSize:6,color:"#4a7080"}}>Size: <span style={{color:"#f0c070"}}>${(Number(t.size)||0).toFixed(2)}</span></span>
                      <span style={{fontSize:6,color:"#4a7080"}}>Price: <span style={{color:"#c8d8e0"}}>{(Number(t.price)||0).toFixed(4)}</span></span>
                      <span style={{fontSize:6,color:"#4a7080"}}>Time: <span style={{color:"#8ab8c8"}}>{t.timestamp?new Date(Number(t.timestamp)*1000).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):"—"}</span></span>
                    </div>
                  </div>
                </details>
              ))}
              {whaleTrades.length===0&&<div style={{fontSize:8,color:"#304858",padding:"8px 0"}}>Loading live trades...</div>}
            </div>
          )}
        </div>

        {/* MOBILE BOTTOM NAV */}
        <div style={{position:"fixed",bottom:0,left:0,right:0,background:"#070a0d",borderTop:"1px solid #0c1c28",display:"flex",paddingBottom:"env(safe-area-inset-bottom)",zIndex:100}}>
          {NAV_ITEMS.map(({key,icon,label})=>(
            <button key={key} className="nav-btn" onClick={()=>setMobileTab(key)} style={{color:mobileTab===key?"#00ff8c":"#4a6070"}}>
              <span style={{fontSize:18}}>{icon}</span>
              <span style={{fontSize:8,letterSpacing:".08em",fontWeight:mobileTab===key?500:400}}>{label}</span>
              {mobileTab===key&&<div style={{width:20,height:2,background:"#00ff8c",borderRadius:1,marginTop:1}}/>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── DESKTOP LAYOUT ────────────────────────────────────────
  return (
    <div style={{background:"#07090c",minHeight:"100vh",fontFamily:"'DM Mono',monospace",color:"#ffffff",overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:#08090c}::-webkit-scrollbar-thumb{background:#18283a}
        .pulse{animation:pulse 2s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
        .blink{animation:blink 1.2s step-end infinite}@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        .flashrow{animation:fl .8s ease}@keyframes fl{0%{background:rgba(0,255,140,.08)}100%{background:transparent}}
        .rh:hover{background:rgba(0,200,120,.025)!important}
        .tb{background:none;border:none;cursor:pointer;font-family:inherit}
        .tf-btn{background:none;border:none;cursor:pointer;font-family:inherit;padding:3px 9px;font-size:9px;letter-spacing:.12em;border-radius:3px;transition:all .15s}
        .tf-btn:hover{background:#0c1c28}
        .timer-bar{transition:width .9s linear}
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
          <span style={{fontSize:9,color:"#c8d8e0"}}>{new Date().toLocaleString("en-US",{timeZone:"America/Los_Angeles",month:"numeric",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"})} <span className="blink">_</span></span>
          {apiError&&<span style={{fontSize:9,color:"#ff4455",letterSpacing:".1em"}}>⚠ API OFFLINE</span>}
        </div>
        <div style={{display:"flex",gap:28}}>
          {[
            {l:"BALANCE",  v:fmt$(portfolio.balance),c:"#ffffff"},
            {l:"TODAY",    v:`${sign(portfolio.daily_pnl)}${fmt$(portfolio.daily_pnl)}`,c:portfolio.daily_pnl>=0?"#00ff8c":"#ff4455"},
            {l:"WIN RATE", v:fmtPct(portfolio.win_rate),c:"#f0c070"},
            {l:"TRADES",   v:`${portfolio.total_trades}`,c:"#80c8e0"},
            {l:"DRAWDOWN", v:fmtPct(portfolio.drawdown_pct),c:"#c8d8e0"},
            {l:"🐋 WHALES",v:`${WHALES.length} tracked`,c:"#f0c070"},
          ].map(({l,v,c})=>(
            <div key={l} style={{textAlign:"right"}}>
              <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".16em",marginBottom:2}}>{l}</div>
              <div style={{fontSize:12,color:c,fontWeight:500}}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"196px 1fr 320px",height:"calc(100vh - 46px)"}}>
        {/* LEFT PANEL */}
        <div style={{background:"#070a0d",borderRight:"1px solid #0c1c28",padding:"14px 11px",overflowY:"auto",display:"flex",flexDirection:"column",gap:7}}>
          <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".2em",marginBottom:4}}>AGENTS</div>
          {Object.entries(agentData).filter(([name])=>["no_bot","binance_bot","exit_monitor","copy_bot"].includes(name)).map(([name,a])=>(
            <div key={name} style={{padding:"4px 8px",borderBottom:"1px solid #0a0c10",display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:5,height:5,borderRadius:"50%",flexShrink:0,background:a.status==="running"?"#00ff8c":a.status==="error"?"#ff4455":"#304858",boxShadow:a.status==="running"?"0 0 4px #00ff8c":"none"}} className={a.status==="running"?"pulse":""}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:7,color:"#8ab8c8",letterSpacing:".06em",fontWeight:700}}>{name.replace(/_/g," ").toUpperCase()}</span>
                  <span style={{fontSize:6,color:a.status==="running"?"#00cc70":a.status==="error"?"#ff4455":"#304858",letterSpacing:".08em"}}>{a.status?.toUpperCase()}</span>
                </div>
                <div style={{fontSize:7,color:"#c8d8e0",whiteSpace:"normal",marginTop:1,lineHeight:1.3,wordBreak:"break-word"}}>{a.message}</div>
              </div>
            </div>
          ))}
          <div style={{marginTop:8}}>
            <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".2em",marginBottom:6}}>RISK ENGINE</div>
            {[["Kelly Cap","10%"],["Daily Loss","−10%"],["Max Draw","−20%"],["Open Pos",`${portfolio.open_positions}/20`]].map(([l,v])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid #09090d"}}>
                <span style={{fontSize:7,color:"#c8d8e0"}}>{l}</span>
                <span style={{fontSize:7,fontWeight:700,color:v.startsWith("−")||v.startsWith("-")?"#ff4455":v.includes("/")?"#80c8e0":"#00ff8c"}}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{marginTop:8}}>
            <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".2em",marginBottom:6}}>LEADERBOARD · {WHALES.length} WALLETS</div>
            {WHALES.map((w,i)=>(<WhaleCard key={i} w={w}/>))}
          </div>
          <div style={{marginTop:8}}>
            <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".18em",marginBottom:6}}>RECENT WHALE TRADES · LIVE</div>
              {whaleTrades.slice(0,20).map((t,i)=>(
                <details key={i} style={{borderBottom:"1px solid #0a0c10",padding:"4px 0",cursor:"pointer"}}>
                  <summary style={{listStyle:"none",outline:"none"}}>
                    <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:1}}>
                      <span style={{fontSize:6,padding:"1px 4px",borderRadius:2,background:t.side==="BUY"?"#002010":"#200010",color:t.side==="BUY"?"#00a858":"#ff4455",flexShrink:0,fontWeight:600}}>{t.side}</span>
                      <span style={{fontSize:7,color:"#f0c070",flexShrink:0,fontWeight:600}}>{t.name}</span>
                      <span style={{fontSize:7,color:"#8ab8c8",flexShrink:0}}>${(Number(t.size)||0).toFixed(0)}</span>
                      <span style={{fontSize:6,color:"#4a7080",flexShrink:0}}>@{(Number(t.price)||0).toFixed(3)}</span>
                      <span style={{fontSize:7,color:"#8ab8c8",flexShrink:0,marginLeft:"auto",whiteSpace:"nowrap"}}>{t.timestamp?new Date(Number(t.timestamp)*1000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"—"}</span>
                    </div>
                    <div style={{fontSize:6,color:"#c8d8e0",paddingLeft:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.market}</div>
                  </summary>
                  <div style={{padding:"4px",marginTop:2,background:"#060809",borderRadius:2}}>
                    <div style={{fontSize:7,color:"#c8d8e0",lineHeight:1.5,wordBreak:"break-word"}}>{t.market}</div>
                    <div style={{display:"flex",gap:8,marginTop:3,flexWrap:"wrap"}}>
                      <span style={{fontSize:6,color:"#4a7080"}}>Outcome: <span style={{color:"#c8d8e0"}}>{t.outcome||"—"}</span></span>
                      <span style={{fontSize:6,color:"#4a7080"}}>Size: <span style={{color:"#f0c070"}}>${(Number(t.size)||0).toFixed(2)}</span></span>
                      <span style={{fontSize:6,color:"#4a7080"}}>Price: <span style={{color:"#c8d8e0"}}>{(Number(t.price)||0).toFixed(4)}</span></span>
                      <span style={{fontSize:6,color:"#4a7080"}}>Time: <span style={{color:"#8ab8c8"}}>{t.timestamp?new Date(Number(t.timestamp)*1000).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):"—"}</span></span>
                    </div>
                  </div>
                </details>
              ))}
            {whaleTrades.length===0&&<div style={{fontSize:7,color:"#304858",padding:"4px 0"}}>Loading live trades...</div>}
          </div>
        </div>

        {/* CENTER */}
        <div style={{display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {/* Chart */}
          <div style={{background:"#090c10",borderBottom:"1px solid #0c1c28",padding:"13px 18px",flexShrink:0}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:8,color:"#8ab8c8",letterSpacing:".2em"}}>PORTFOLIO</span>
                <div style={{display:"flex",gap:2,background:"#0a0d12",border:"1px solid #0c1c28",borderRadius:4,padding:"2px"}}>
                  {TIMEFRAMES.map((t,i)=>(
                    <button key={t.label} className="tf-btn" onClick={()=>switchTf(i)} style={{color:tfIdx===i?"#00ff8c":"#4a6070",background:tfIdx===i?"#0a1e14":"none",border:tfIdx===i?"1px solid #00ff8c22":"1px solid transparent",fontWeight:tfIdx===i?500:400}}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{display:"flex",gap:14,alignItems:"center"}}>
                <span style={{fontSize:12,color:(showRealized?portfolio.daily_pnl:(portfolio.open_pnl||0))>=0?"#00ff8c":"#ff4455",fontWeight:500}}>{sign(showRealized?portfolio.daily_pnl:(portfolio.open_pnl||0))}{fmt$(Math.abs(showRealized?portfolio.daily_pnl:(portfolio.open_pnl||0)))}</span>
                <span style={{fontSize:11,color:"#c8d8e0"}}>{sign(showRealized?portfolio.daily_pnl:(portfolio.open_pnl||0))}{(Math.abs((showRealized?portfolio.daily_pnl:(portfolio.open_pnl||0))/1000)*100).toFixed(2)}%</span>
                <button onClick={()=>setShowRealized(r=>!r)} style={{fontSize:8,padding:"2px 8px",borderRadius:3,background:showRealized?"#0a1e14":"#0a0d12",border:showRealized?"1px solid #00ff8c44":"1px solid #1a2a38",color:showRealized?"#00ff8c":"#4a6070",cursor:"pointer"}}>{showRealized?"REALIZED":"TOTAL"}</button>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={80}>
              <LineChart data={pnlData} margin={{top:2,right:2,bottom:0,left:0}}>
                <defs><linearGradient id="lg2" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#006840"/><stop offset="100%" stopColor="#00ff8c"/></linearGradient></defs>
                <XAxis dataKey="time" tick={{fill:"#8ab8c8",fontSize:8}} axisLine={false} tickLine={false} interval={Math.floor(pnlData.length/5)}/>
                <YAxis tick={{fill:"#8ab8c8",fontSize:8}} axisLine={false} tickLine={false} width={44} tickFormatter={v=>`$${v.toFixed(0)}`} domain={["auto","auto"]}/>
                <Tooltip contentStyle={{background:"#0b0e14",border:"1px solid #0c1c28",borderRadius:3,fontSize:10}} labelStyle={{color:"#c8d8e0"}} itemStyle={{color:"#00ff8c"}} formatter={v=>[fmt$(v),"Balance"]}/>
                <ReferenceLine y={p0} stroke="#8ab8c8" strokeDasharray="3 3"/>
                <Line type="monotone" dataKey={chartKey} stroke="url(#lg2)" strokeWidth={1.5} dot={false} activeDot={{r:3,fill:"#00ff8c"}}/>
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Desktop tabs */}
          <div style={{display:"flex",borderBottom:"1px solid #0c1c28",background:"#070a0d",flexShrink:0}}>
            {[["positions",POSITIONS.length],["trades",TRADES.length],["queue",QUEUE.length]].map(([t,n])=>(
              <button key={t} className="tb" onClick={()=>setDesktopTab(t)} style={{padding:"8px 16px",fontSize:9,letterSpacing:".12em",color:desktopTab===t?"#00ff8c":"#8ab8c8",borderBottom:desktopTab===t?"2px solid #00ff8c":"2px solid transparent",marginBottom:-1,transition:"color .15s"}}>
                {t.toUpperCase()} <span style={{marginLeft:5,fontSize:8,color:desktopTab===t?"#009860":"#c8d8e0"}}>{n}</span>
              </button>
            ))}
          </div>
          <div style={{flex:1,overflowY:"auto"}}>
            {desktopTab==="positions"&&(POSITIONS.length===0?<div style={{padding:"40px",textAlign:"center",color:"#8ab8c8",fontSize:11}}>No open positions yet</div>:(
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:9}}>
                <thead style={{background:"#070a0d",position:"sticky",top:0}}>
                  <tr>{["MARKET","ENTRY","YES","NO","EST.","SIZE","HELD","EXPIRES","UNRLZD","%",""].map(h=>(<th key={h} style={{padding:"6px 8px",textAlign:"left",color:"#8ab8c8",fontSize:7,letterSpacing:".12em",fontWeight:400,borderBottom:"1px solid #0c1c28",whiteSpace:"nowrap"}}>{h}</th>))}</tr>
                </thead>
                <tbody>{POSITIONS.map((p,i)=>{
                  const noPrice = p.current_price!=null?(1-p.current_price).toFixed(3):"—";
                  const heldHrs = p.opened_at?((Date.now()-new Date(p.opened_at+"Z").getTime())/3600000).toFixed(1)+"h":"—";
                  const expires = p.expires_at?new Date(p.expires_at).toLocaleDateString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):"—";
                  return(<tr key={i} className="rh" style={{borderBottom:"1px solid #07080b"}}>
                    <td style={{padding:"8px",color:"#fff",maxWidth:260,fontSize:9,lineHeight:1.4,wordBreak:"break-word"}}>
                      <div>{p.question}</div>
                      {p.thesis&&<div style={{fontSize:7,color:"#4a7080",marginTop:3,lineHeight:1.4,fontStyle:"italic"}}>"{p.thesis}"</div>}
                    </td>
                    <td style={{padding:"8px",whiteSpace:"nowrap"}}>{p.question?.includes("[COPY")?<span style={{color:"#c8d8e0"}}>{p.no_price?.toFixed(3)}</span>:<span style={{background:"#00300f",color:"#00ff8c",padding:"1px 5px",borderRadius:3,fontWeight:700,border:"1px solid #00ff8c44"}}>{p.no_price?.toFixed(3)}</span>}</td>
                    <td style={{padding:"8px",whiteSpace:"nowrap"}}>{p.question?.includes("[COPY")?<span style={{background:"#001830",color:"#4ab8ff",padding:"1px 5px",borderRadius:3,fontWeight:700,border:"1px solid #4ab8ff44"}}>{p.yes_price?.toFixed(3)}</span>:<span style={{color:"#c8d8e0"}}>{p.yes_price?.toFixed(3)}</span>}</td>
                    <td style={{padding:"8px",color:p.current_price>p.entry_price?"#00a858":"#ff4455",whiteSpace:"nowrap"}}>{p.current_price?.toFixed(3)}</td>
                    <td style={{padding:"8px",color:"#f0c070",whiteSpace:"nowrap"}}>{fmtPct(p.our_probability||0)}</td>
                    <td style={{padding:"8px",color:"#fff",whiteSpace:"nowrap"}}>{fmt$(p.size_usd||0)}</td>
                    <td style={{padding:"8px",color:"#8ab8c8",whiteSpace:"nowrap"}}>{heldHrs}</td>
                    <td style={{padding:"8px",color:"#607888",fontSize:8,whiteSpace:"nowrap"}}>{expires}</td>
                    <td style={{padding:"8px",color:(p.unrealized_pnl||0)>=0?"#00a858":"#ff4455",fontWeight:500,whiteSpace:"nowrap"}}>{sign(p.unrealized_pnl||0)}{fmt$(p.unrealized_pnl||0)}</td>
                    <td style={{padding:"8px",whiteSpace:"nowrap"}}>
                      <button onClick={async()=>{if(!window.confirm("Close this position?"))return;await fetch(`${API_BASE}/api/close_position/${p.id}`,{method:"POST"});}} style={{fontSize:7,padding:"2px 7px",borderRadius:2,background:"#200010",color:"#ff6070",border:"1px solid #400020",cursor:"pointer",fontFamily:"inherit",letterSpacing:".1em"}}>SELL</button>
                    </td>
                  </tr>);
                })}</tbody>
              </table>
            ))}
            {desktopTab==="trades"&&(TRADES.length===0?<div style={{padding:"40px",textAlign:"center",color:"#8ab8c8",fontSize:11}}>No closed trades yet</div>:(
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                <thead style={{background:"#070a0d",position:"sticky",top:0}}><tr>{["MARKET","ENTRY","EXIT","P&L","REASON"].map(h=>(<th key={h} style={{padding:"7px 10px",textAlign:"left",color:"#8ab8c8",fontSize:8,letterSpacing:".12em",fontWeight:400,borderBottom:"1px solid #0c1c28"}}>{h}</th>))}</tr></thead>
                <tbody>{TRADES.map((t,i)=>{
  const fmtDt = dt => dt ? new Date(dt.endsWith('Z')?dt:dt+'Z').toLocaleString("en-US",{timeZone:"America/Los_Angeles",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}) : "—";
  return(<tr key={i} className="rh" style={{borderBottom:"1px solid #07080b"}}>
    <td style={{padding:"8px 10px",color:"#fff",maxWidth:200}}><div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.question}</div></td>
    <td style={{padding:"8px 10px",color:"#c8d8e0",whiteSpace:"nowrap"}}><div>{t.entry_price?.toFixed(3)}</div><div style={{fontSize:8,color:"#4a6070",marginTop:2}}>{fmtDt(t.opened_at)}</div></td>
    <td style={{padding:"8px 10px",color:"#fff",whiteSpace:"nowrap"}}><div>{t.exit_price?.toFixed(3)}</div><div style={{fontSize:8,color:"#4a6070",marginTop:2}}>{fmtDt(t.closed_at)}</div></td>
    <td style={{padding:"8px 10px",fontWeight:500,color:(t.pnl||0)>=0?"#00a858":"#ff4455",whiteSpace:"nowrap"}}>{sign(t.pnl||0)}{fmt$(t.pnl||0)}</td>
    <td style={{padding:"8px 10px"}}><span style={{fontSize:8,padding:"2px 6px",borderRadius:2,background:t.exit_reason==="TARGET_HIT"?"#002010":t.exit_reason==="STOP_LOSS"?"#240010":"#141400",color:t.exit_reason==="TARGET_HIT"?"#00a858":t.exit_reason==="STOP_LOSS"?"#ff4455":"#a09020"}}>{t.exit_reason}</span></td>
  </tr>);
})}</tbody>
              </table>
            ))}
            {desktopTab==="queue"&&(QUEUE.length===0?<div style={{padding:"40px",textAlign:"center",color:"#8ab8c8",fontSize:11}}>No theses yet</div>:<div style={{padding:"12px"}}>{QUEUE.map((q,i)=>(<div key={i} style={{background:"#0a0d12",border:"1px solid #0c1c28",borderLeft:"3px solid #007848",borderRadius:3,padding:"11px 13px",marginBottom:8}}><div style={{fontSize:10,color:"#fff",marginBottom:5}}>{q.question}</div><div style={{display:"flex",gap:16,marginBottom:5}}><span style={{fontSize:9,color:"#c8d8e0"}}>Mkt: <span style={{color:"#fff"}}>{q.price?.toFixed(2)}</span></span><span style={{fontSize:9,color:"#c8d8e0"}}>Edge: <span style={{color:"#f0c070"}}>+{fmtPct(q.edge||0)}</span></span><span style={{fontSize:9,color:"#c8d8e0"}}>Conf: <span style={{color:"#00a858"}}>{q.confidence}</span></span><span style={{fontSize:9,color:"#c8d8e0"}}>Bet: <span style={{color:"#f0c070"}}>{fmt$(q.suggested_size||0)}</span></span></div><div style={{fontSize:9,color:"#c8d8e0",fontStyle:"italic"}}>"{q.thesis}"</div></div>))}</div>)}
          </div>
        </div>

        {/* RIGHT — ACTIVITY + STATS */}
        <div style={{background:"#070a0d",borderLeft:"1px solid #0c1c28",display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {/* Activity Feed Header */}
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",borderBottom:"1px solid #0c1c28",flexShrink:0}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:newActivity?"#00ff8c":"#304858",boxShadow:newActivity?"0 0 7px #00ff8c":"none",transition:"all .3s"}} className={newActivity?"pulse":""}/>
            <span style={{fontSize:8,color:"#8ab8c8",letterSpacing:".2em"}}>CLAUDE ACTIVITY FEED</span>
            <span style={{fontSize:8,color:"#304858"}}>· every 5s</span>
            <div style={{display:"flex",gap:6,marginLeft:"auto"}}>
              {Object.entries(ET).slice(0,5).map(([k,v])=>(<span key={k} style={{fontSize:6,color:v.color,letterSpacing:".1em"}}>{v.icon} {v.label}</span>))}
            </div>
          </div>
          {/* Activity Feed */}
          <div ref={activityRef} style={{overflowY:"auto",flex:1,minHeight:0,padding:"4px 0",borderBottom:"1px solid #0c1c28"}}>
            {activity.length===0?(
              <div style={{padding:"16px 14px",color:"#304858",fontSize:10,textAlign:"center"}}>Waiting for bot activity...</div>
            ):activity.map((log,i)=>{
              const et=ET[log.event_type]||ET.SCANNING;
              return(
                <div key={log.id} className={i===0&&newActivity?"flashrow":""} style={{padding:"4px 8px",borderBottom:"1px solid #0a0c10"}}>
                  <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:1}}>
                    <span style={{fontSize:6,padding:"1px 4px",borderRadius:2,background:et.color+"18",color:et.color,whiteSpace:"nowrap",flexShrink:0,fontWeight:700}}>{et.icon} {et.label}</span>
                    <span style={{fontSize:6,color:"#243848",flexShrink:0}}>{log.logged_at?new Date(log.logged_at).toLocaleTimeString("en-US",{timeZone:"America/Los_Angeles",hour:"2-digit",minute:"2-digit"}):""}</span>
                    <span style={{fontSize:6,color:"#243848",marginLeft:"auto",flexShrink:0}}>{log.time_ago}</span>
                  </div>
                  {log.market&&<div style={{fontSize:7,color:"#8ab8c8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:1,fontWeight:600}}>{log.market}</div>}
                  <div style={{fontSize:7,color:et.color==="#4a5868"?"#506070":"#c8d8e0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{log.message}</div>
                  {log.detail&&<div style={{fontSize:6,color:"#3a5060",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginTop:1}}>{log.detail}</div>}
                </div>
              );
            })}
          </div>
          {/* Bottom Stats - scrollable so activity feed always has space */}
          <div style={{overflowY:"auto",maxHeight:"340px",flexShrink:0,borderTop:"1px solid #0c1c28"}}>
          {/* Current Exposure by Category */}
          <div style={{padding:"8px 12px",borderBottom:"1px solid #0c1c28"}}>
            <div style={{fontSize:7,color:"#4a6070",letterSpacing:".18em",marginBottom:6}}>CURRENT EXPOSURE BY CATEGORY</div>
            {[
              {cat:"CRYPTO",  color:"#0088ff", pct: POSITIONS.filter(p=>["crypto","btc","eth","sol","bitcoin","ethereum","solana","binance","usdc","token","xrp","bnb","up or down"].some(k=>p.question?.toLowerCase().includes(k))).length / Math.max(POSITIONS.length,1)},
              {cat:"SPORTS",  color:"#aa66ff", pct: POSITIONS.filter(p=>["ufc","nfl","nba","nhl","mlb","soccer","football","basketball","blazers","spurs","lakers","celtics","warriors","knicks","bulls","heat","nets","vs.","fight night","match","o/u","over","under","rebounds","points","goals","innings"].some(k=>p.question?.toLowerCase().includes(k))).length / Math.max(POSITIONS.length,1)},
              {cat:"POLITICS",color:"#00cc66", pct: POSITIONS.filter(p=>["trump","biden","senate","congress","election","president","democrat","republican","vote","poll","iran","diplomatic","tariff","sanctions","treaty","prime minister","chancellor","minister"].some(k=>p.question?.toLowerCase().includes(k))).length / Math.max(POSITIONS.length,1)},
              {cat:"MACRO",   color:"#f0c070", pct: POSITIONS.filter(p=>["fed","rate","cpi","gdp","inflation","interest","recession","treasury","bond","dollar","trade","strait","hormuz","ships","transit","oil","barrel","opec","currency","yuan","euro","yen","gold","silver"].some(k=>p.question?.toLowerCase().includes(k))).length / Math.max(POSITIONS.length,1)},
              {cat:"ESPORTS", color:"#ff6644", pct: POSITIONS.filter(p=>["valorant","dota","csgo","lol:","league of legends","esport","gaming","gen.g","nongshim","bo3","bo5","lck","lcs","lec","fnatic","t1","c9","mobile legends","mlbb","mpl"].some(k=>p.question?.toLowerCase().includes(k))).length / Math.max(POSITIONS.length,1)},
            ].map(({cat,color,pct})=>(
              <div key={cat} style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                <span style={{fontSize:7,color:"#6a9090",width:52,flexShrink:0}}>{cat}</span>
                <div style={{flex:1,height:3,background:"#0c1c28",borderRadius:2}}>
                  <div style={{width:`${Math.round(pct*100)}%`,height:3,background:color,borderRadius:2}}/>
                </div>
                <span style={{fontSize:7,color:color,width:28,textAlign:"right",flexShrink:0,fontWeight:600}}>{Math.round(pct*100)}%</span>
              </div>
            ))}
          </div>
          {/* Historical Win % by Category */}
          <div style={{padding:"8px 12px",flexShrink:0}}>
            <div style={{fontSize:7,color:"#4a6070",letterSpacing:".18em",marginBottom:6}}>HISTORICAL WIN % BY CATEGORY</div>
            {categoryStats.length === 0 ? (
              <div style={{fontSize:7,color:"#243848",textAlign:"center",padding:"4px 0"}}>No closed trades yet</div>
            ) : categoryStats.filter(c=>c.total>0).map(({category,win_rate,pnl})=>{
              const CAT_COLORS = {CRYPTO:"#0088ff",POLITICS:"#aa66ff",SPORTS:"#ff4455",MACRO:"#f0c070",ESPORTS:"#ff6644"};
              const color = CAT_COLORS[category] || "#8ab8c8";
              const win = Math.round(win_rate * 100);
              const pnlStr = `${pnl>=0?"+":"-"}$${Math.abs(pnl).toFixed(0)}`;
              return (
                <div key={category} style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                  <span style={{fontSize:7,color:"#6a9090",width:52,flexShrink:0}}>{category}</span>
                  <div style={{flex:1,height:3,background:"#0c1c28",borderRadius:2}}>
                    <div style={{width:`${win}%`,height:3,background:color,borderRadius:2}}/>
                  </div>
                  <span style={{fontSize:7,color:win>=50?"#00a858":"#ff4455",width:24,textAlign:"right",flexShrink:0,fontWeight:600}}>{win}%</span>
                  <span style={{fontSize:7,color:pnl>=0?"#00a858":"#ff4455",width:34,textAlign:"right",flexShrink:0}}>{pnlStr}</span>
                </div>
              );
            })}
          </div>
          {/* Strategy Intelligence */}
          <div style={{padding:"8px 12px",borderTop:"1px solid #0c1c28",flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
              <div style={{fontSize:7,color:"#4a6070",letterSpacing:".18em"}}>STRATEGY INTELLIGENCE</div>
              {insights?.analyzed_at&&<span style={{fontSize:6,color:"#243848"}}>{new Date(insights.analyzed_at).toLocaleTimeString("en-US",{timeZone:"America/Los_Angeles",hour:"2-digit",minute:"2-digit"})}</span>}
            </div>
            {!insights&&<div style={{fontSize:7,color:"#243848",textAlign:"center",padding:"8px 0"}}>Awaiting first analysis...</div>}
            {insights&&(<>
              <div style={{fontSize:7,color:"#8ab8c8",lineHeight:1.4,marginBottom:5}}>{insights.summary}</div>
              {(insights.warnings||[]).map((w,i)=>(
                <div key={i} style={{display:"flex",alignItems:"flex-start",gap:4,marginBottom:3}}>
                  <span style={{color:"#ff4455",fontSize:7,flexShrink:0}}>⚠</span>
                  <span style={{fontSize:7,color:"#ff6070",lineHeight:1.3}}>{w}</span>
                </div>
              ))}
              {(insights.recommendations||[]).map((r,i)=>(
                <div key={i} style={{display:"flex",alignItems:"flex-start",gap:4,marginBottom:3}}>
                  <span style={{color:"#00a858",fontSize:7,flexShrink:0}}>⚡</span>
                  <span style={{fontSize:7,color:"#00c86e",lineHeight:1.3}}>{r}</span>
                </div>
              ))}
            </>)}
          </div>
          </div>{/* end bottom stats wrapper */}
        </div>
      </div>
    </div>
  );
}
