import { useState, useEffect, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

const API_BASE = "https://api.feliksbot.com";

const TIMEFRAMES = [
  { label: "1D",  points: 1   },
  { label: "7D",  points: 7   },
  { label: "30D", points: 30  },
  { label: "ALL", points: 999 },
];

// ── CITY METADATA (resolution stations, colors) ──────────────────
const CITIES = {
  NYC:     { station: "KLGA",  color: "#f0c070", label: "New York"    },
  Chicago: { station: "KORD",  color: "#80c8e0", label: "Chicago"     },
  Dallas:  { station: "KDAL",  color: "#e07888", label: "Dallas"      },
  LA:      { station: "KCQT",  color: "#00c8a0", label: "Los Angeles" },
};

const CITY_LIST = Object.keys(CITIES);

// ── FORMATTERS ────────────────────────────────────────────────────
const fmt$   = n => `${n<0?"-":""}$${Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtPct = n => `${n<0?"-":""}${Math.abs(n*100).toFixed(1)}%`;
const sign   = n => n>=0?"+":"";

// ── BADGES ───────────────────────────────────────────────────────
const CityBadge = ({city}) => {
  const c = CITIES[city];
  if (!c) return <span>{city}</span>;
  return (
    <span style={{fontSize:7,padding:"1px 5px",borderRadius:2,letterSpacing:".1em",color:c.color,background:c.color+"18",fontWeight:600}}>
      {city}
    </span>
  );
};

const DirectionBadge = ({dir}) => (
  <span style={{fontSize:7,padding:"1px 5px",borderRadius:2,letterSpacing:".1em",background:dir==="YES"?"#002010":"#200010",color:dir==="YES"?"#00ff8c":"#ff6070",fontWeight:700}}>
    {dir}
  </span>
);

const CalibrationRow = ({row}) => {
  const c = CITIES[row.city] || {color:"#8ab8c8"};
  const pct = (row.pct_within_3f || 0);
  return (
    <div style={{padding:"4px 6px",borderBottom:"1px solid #0a0c10",fontSize:7}}>
      <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:2}}>
        <div style={{width:4,height:4,borderRadius:"50%",background:c.color,boxShadow:`0 0 3px ${c.color}`}}/>
        <span style={{color:"#c8d8e0",fontWeight:600,flex:1}}>{row.city}</span>
        <span style={{color:c.color,fontSize:6}}>{c.station}</span>
      </div>
      <div style={{display:"flex",gap:8,paddingLeft:8,color:"#8ab8c8"}}>
        <span>σ <span style={{color:"#f0c070"}}>{row.sigma_f?.toFixed(2)}°F</span></span>
        <span>MAE <span style={{color:"#80c8e0"}}>{row.mae_f?.toFixed(2)}°F</span></span>
        <span>&le;3°F <span style={{color:"#00a858"}}>{pct.toFixed(0)}%</span></span>
      </div>
    </div>
  );
};

// ── NAV ───────────────────────────────────────────────────────────
const NAV_ITEMS = [
  {key:"overview",   icon:"◈", label:"Overview"},
  {key:"signals",    icon:"◆", label:"Signals"},
  {key:"trades",     icon:"↕", label:"Trades"},
  {key:"activity",   icon:"⟳", label:"Activity"},
  {key:"calibration",icon:"⚙", label:"Calibration"},
];

// ── EVENT TYPES (activity feed) ──────────────────────────────────
const ET = {
  SCANNING:   {color:"#80c8e0",icon:"⟳",label:"SCAN"},
  EVALUATING: {color:"#a080f0",icon:"◈",label:"EVAL"},
  THESIS:     {color:"#00ff8c",icon:"✦",label:"THESIS"},
  TRADE:      {color:"#f0c070",icon:"◆",label:"TRADE"},
  EXIT:       {color:"#e07888",icon:"✕",label:"EXIT"},
  SKIP:       {color:"#4a5868",icon:"–",label:"SKIP"},
  ERROR:      {color:"#ff4455",icon:"!",label:"ERROR"},
};

export default function Dashboard() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [tfIdx, setTfIdx]       = useState(2);  // 30D
  const [mobileTab, setMobileTab] = useState("overview");
  const [desktopTab, setDesktopTab] = useState("signals");
  const [elapsed, setElapsed]   = useState(0);
  const [apiError, setApiError] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState(false);
  const activityRef = useRef(null);

  const [portfolio, setPortfolio] = useState({
    balance:1000, daily_pnl:0, total_pnl:0, win_rate:0,
    open_positions:0, drawdown_pct:0, total_trades:0, paper_trading:true, roi_pct:0
  });
  const [signals,     setSignals]     = useState([]);
  const [results,     setResults]     = useState([]);
  const [calibration, setCalibration] = useState([]);
  const [cityStats,   setCityStats]   = useState([]);
  const [pnlSeries,   setPnlSeries]   = useState([]);
  const [scanner,     setScanner]     = useState({status:"unknown",message:"Loading...",signals_24h:0});
  const [activity,    setActivity]    = useState([]);
  const [showRealized, setShowRealized] = useState(false);
  const [prevActivityId, setPrevActivityId] = useState(null);
  const [newActivity, setNewActivity] = useState(false);

  // ── Resize listener ───────────────────────────────────────────
  useEffect(()=>{
    const handle = ()=>setIsMobile(window.innerWidth<768);
    window.addEventListener("resize",handle);
    return()=>window.removeEventListener("resize",handle);
  },[]);

  // ── Main data fetch ───────────────────────────────────────────
  useEffect(()=>{
    const fetchData = async () => {
      try {
        const [port,sigs,res,cal,cs,pnl,scan] = await Promise.all([
          fetch(`${API_BASE}/api/weather/portfolio`).then(r=>r.json()),
          fetch(`${API_BASE}/api/weather/signals`).then(r=>r.json()),
          fetch(`${API_BASE}/api/weather/results`).then(r=>r.json()),
          fetch(`${API_BASE}/api/weather/calibration`).then(r=>r.json()),
          fetch(`${API_BASE}/api/weather/city_stats`).then(r=>r.json()),
          fetch(`${API_BASE}/api/weather/pnl_history`).then(r=>r.json()),
          fetch(`${API_BASE}/api/weather/scanner_status`).then(r=>r.json()),
        ]);
        setPortfolio(port);
        setSignals(sigs||[]);
        setResults(res||[]);
        setCalibration(cal||[]);
        setCityStats(cs||[]);
        setPnlSeries(pnl||[]);
        setScanner(scan||{status:"unknown",message:"No data"});
        setApiError(false);
      } catch(e){ setApiError(true); }
    };
    fetchData();
    const interval = setInterval(fetchData, 15000);  // 15s polling — weather is slow-moving
    return()=>clearInterval(interval);
  },[]);

  // ── Activity feed ─────────────────────────────────────────────
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

  // ── Filter P&L by timeframe ───────────────────────────────────
  const filteredPnl = (() => {
    if (!pnlSeries.length) return [];
    const tf = TIMEFRAMES[tfIdx];
    if (tf.label === "ALL") return pnlSeries;
    return pnlSeries.slice(-tf.points - 1);
  })();

  const chartKey = "balance";
  const p0 = filteredPnl[0]?.[chartKey] ?? 1000;
  const pN = filteredPnl[filteredPnl.length-1]?.[chartKey] ?? 1000;
  const pd = pN - p0;

  // Split signals into YES and NO for display
  const yesSignals = signals.filter(s=>s.direction==="YES");
  const noSignals  = signals.filter(s=>s.direction==="NO");

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
            <span style={{fontSize:9,color:"#8ab8c8",letterSpacing:".1em"}}>WEATHER</span>
            <span style={{fontSize:10,color:"#f0c070",letterSpacing:".1em",background:"#1e1000",padding:"2px 7px",borderRadius:3}}>{portfolio.paper_trading?"PAPER":"LIVE"}</span>
          </div>
          <span style={{fontSize:10,color:"#8ab8c8"}}>{new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})} <span className="blink">_</span></span>
        </div>

        {/* MOBILE CONTENT */}
        <div style={{flex:1,overflowY:"auto",padding:"12px 14px",paddingBottom:80}}>

          {/* OVERVIEW TAB */}
          {mobileTab==="overview" && (
            <div>
              <div className="mob-card" style={{textAlign:"center",marginBottom:10}}>
                <div style={{fontSize:11,color:"#8ab8c8",letterSpacing:".16em",marginBottom:4}}>BALANCE</div>
                <div style={{fontSize:36,fontWeight:500,color:"#ffffff",marginBottom:4}}>{fmt$(portfolio.balance)}</div>
                <div style={{fontSize:14,color:portfolio.daily_pnl>=0?"#00ff8c":"#ff4455"}}>
                  {sign(portfolio.daily_pnl)}{fmt$(portfolio.daily_pnl)} today
                </div>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
                {[
                  ["WIN RATE", fmtPct(portfolio.win_rate), "#f0c070"],
                  ["TRADES",   portfolio.total_trades,      "#80c8e0"],
                  ["OPEN",     portfolio.open_positions,    "#00ff8c"]
                ].map(([l,v,c])=>(
                  <div key={l} className="mob-card" style={{padding:"10px",textAlign:"center",marginBottom:0}}>
                    <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".1em",marginBottom:4}}>{l}</div>
                    <div style={{fontSize:16,color:c,fontWeight:500}}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Chart */}
              <div className="mob-card">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <span style={{fontSize:10,color:"#8ab8c8",letterSpacing:".14em"}}>P&L</span>
                  <span style={{fontSize:12,color:pd>=0?"#00ff8c":"#ff4455",fontWeight:500}}>{sign(pd)}{fmt$(pd)}</span>
                </div>
                <div style={{display:"flex",gap:4,marginBottom:10,background:"#07090c",borderRadius:6,padding:3}}>
                  {TIMEFRAMES.map((t,i)=>(
                    <button key={t.label} className="tf-btn" onClick={()=>setTfIdx(i)} style={{flex:1,color:tfIdx===i?"#00ff8c":"#4a6070",background:tfIdx===i?"#0a1e14":"none",border:tfIdx===i?"1px solid #00ff8c22":"1px solid transparent",fontWeight:tfIdx===i?500:400}}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={filteredPnl} margin={{top:2,right:2,bottom:0,left:0}}>
                    <defs>
                      <linearGradient id="lg" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#006840"/><stop offset="100%" stopColor="#00ff8c"/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="time" tick={{fill:"#8ab8c8",fontSize:8}} axisLine={false} tickLine={false} interval={Math.max(1,Math.floor(filteredPnl.length/4))}/>
                    <YAxis tick={{fill:"#8ab8c8",fontSize:8}} axisLine={false} tickLine={false} width={40} tickFormatter={v=>`$${v.toFixed(0)}`} domain={["auto","auto"]}/>
                    <Tooltip contentStyle={{background:"#0b0e14",border:"1px solid #0c1c28",borderRadius:6,fontSize:11}} formatter={v=>[fmt$(v),"Balance"]}/>
                    <ReferenceLine y={p0} stroke="#8ab8c8" strokeDasharray="3 3"/>
                    <Line type="monotone" dataKey={chartKey} stroke="url(#lg)" strokeWidth={2} dot={false} activeDot={{r:4,fill:"#00ff8c"}}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Scanner status */}
              <div className="mob-card">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <span style={{fontSize:10,color:"#8ab8c8",letterSpacing:".14em"}}>SCANNER</span>
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:scanner.status==="running"?"#00ff8c":scanner.status==="stale"?"#f0c070":"#8ab8c8",boxShadow:scanner.status==="running"?"0 0 5px #00ff8c":"none"}} className={scanner.status==="running"?"pulse":""}/>
                    <span style={{fontSize:9,color:scanner.status==="running"?"#00cc70":scanner.status==="stale"?"#f0c070":"#c8d8e0"}}>{scanner.status?.toUpperCase()}</span>
                  </div>
                </div>
                <div style={{fontSize:10,color:"#c8d8e0",lineHeight:1.4}}>{scanner.message}</div>
              </div>

              {/* City Exposure */}
              <div className="mob-card">
                <div style={{fontSize:10,color:"#8ab8c8",letterSpacing:".14em",marginBottom:8}}>OPEN SIGNALS BY CITY</div>
                {CITY_LIST.map(city => {
                  const stat = cityStats.find(s=>s.city===city) || {open_count:0,open_stake:0,total:0,win_rate:0,pnl:0};
                  const c = CITIES[city];
                  const max = Math.max(...cityStats.map(s=>s.open_count||0), 1);
                  return (
                    <div key={city} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                      <span style={{fontSize:9,color:"#c8d8e0",width:60,flexShrink:0}}>{city}</span>
                      <div style={{flex:1,height:4,background:"#0c1c28",borderRadius:2}}>
                        <div style={{width:`${(stat.open_count/max)*100}%`,height:4,background:c.color,borderRadius:2}}/>
                      </div>
                      <span style={{fontSize:9,color:c.color,width:20,textAlign:"right",flexShrink:0,fontWeight:600}}>{stat.open_count}</span>
                    </div>
                  );
                })}
              </div>

              {/* Calibration summary */}
              <div className="mob-card">
                <div style={{fontSize:10,color:"#8ab8c8",letterSpacing:".14em",marginBottom:8}}>CALIBRATION</div>
                {calibration.map(row => <CalibrationRow key={row.city} row={row}/>)}
              </div>
            </div>
          )}

          {/* SIGNALS TAB */}
          {mobileTab==="signals" && (
            <div>
              <div style={{fontSize:10,color:"#8ab8c8",letterSpacing:".14em",marginBottom:12}}>OPEN SIGNALS · {signals.length}</div>
              {signals.length===0?(
                <div className="mob-card" style={{textAlign:"center",color:"#8ab8c8",fontSize:12,padding:"32px 14px"}}>
                  No edge candidates — scanner is running
                </div>
              ):signals.slice(0,50).map((s,i)=>(
                <div key={i} className="mob-card" style={{borderLeft:`3px solid ${CITIES[s.city]?.color||"#00ff8c"}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                    <CityBadge city={s.city}/>
                    <DirectionBadge dir={s.direction}/>
                    <span style={{fontSize:10,color:"#c8d8e0",fontWeight:600}}>{s.bucket}</span>
                    <span style={{fontSize:9,color:"#4a6070",marginLeft:"auto"}}>{s.lead_hours?.toFixed(1)}h</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:6}}>
                    {[
                      ["MODEL", fmtPct(s.ensemble_prob), "#80c8e0"],
                      ["MARKET", s.market_price?.toFixed(3), "#c8d8e0"],
                      ["EDGE", `+${fmtPct(s.edge)}`, "#00ff8c"],
                    ].map(([l,v,c])=>(
                      <div key={l} style={{textAlign:"center"}}>
                        <div style={{fontSize:8,color:"#8ab8c8",marginBottom:2}}>{l}</div>
                        <div style={{fontSize:11,color:c,fontWeight:500}}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:9,color:"#8ab8c8"}}>
                    <span>{s.n_models_agree}/4 models · {s.n_members} members</span>
                    <span style={{color:"#f0c070",fontWeight:600}}>{fmt$(s.size_usd)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TRADES TAB */}
          {mobileTab==="trades" && (
            <div>
              <div style={{fontSize:10,color:"#8ab8c8",letterSpacing:".14em",marginBottom:12}}>RESOLVED · {results.length}</div>
              {results.length===0?(
                <div className="mob-card" style={{textAlign:"center",color:"#8ab8c8",fontSize:12,padding:"32px 14px"}}>No resolved trades yet</div>
              ):results.slice(0,50).map((t,i)=>(
                <div key={i} className="mob-card">
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                    <CityBadge city={t.city}/>
                    <DirectionBadge dir={t.direction}/>
                    <span style={{fontSize:10,color:"#c8d8e0"}}>{t.bucket}</span>
                    <span style={{fontSize:9,color:"#4a6070",marginLeft:"auto"}}>{t.target_date}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <div style={{fontSize:10,color:"#8ab8c8"}}>
                      Actual: <span style={{color:"#fff"}}>{t.actual_high?.toFixed(1)}°F</span>
                    </div>
                    <span style={{fontSize:15,fontWeight:500,color:(t.pnl||0)>=0?"#00a858":"#ff4455"}}>{sign(t.pnl||0)}{fmt$(t.pnl||0)}</span>
                  </div>
                  <div style={{fontSize:9,color:"#8ab8c8",display:"flex",gap:10}}>
                    <span>Model: <span style={{color:"#c8d8e0"}}>{fmtPct(t.ensemble_prob)}</span></span>
                    <span>Mkt: <span style={{color:"#c8d8e0"}}>{t.market_price?.toFixed(3)}</span></span>
                    <span style={{marginLeft:"auto",padding:"1px 6px",borderRadius:2,background:t.won?"#002010":"#200010",color:t.won?"#00a858":"#ff4455",fontSize:9}}>{t.won?"WON":"LOST"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ACTIVITY TAB */}
          {mobileTab==="activity" && (
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                <div style={{width:7,height:7,borderRadius:"50%",background:newActivity?"#00ff8c":"#304858",boxShadow:newActivity?"0 0 7px #00ff8c":"none"}} className={newActivity?"pulse":""}/>
                <span style={{fontSize:10,color:"#8ab8c8",letterSpacing:".14em"}}>ACTIVITY · live</span>
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

          {/* CALIBRATION TAB */}
          {mobileTab==="calibration" && (
            <div>
              <div style={{fontSize:10,color:"#8ab8c8",letterSpacing:".14em",marginBottom:12}}>FORECAST CALIBRATION</div>
              {calibration.map(row=>{
                const c = CITIES[row.city] || {color:"#8ab8c8",label:row.city,station:""};
                return (
                  <div key={row.city} className="mob-card" style={{borderLeft:`3px solid ${c.color}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
                      <span style={{fontSize:13,color:"#fff",fontWeight:500}}>{c.label}</span>
                      <span style={{fontSize:9,color:c.color,background:c.color+"18",padding:"2px 6px",borderRadius:3}}>{c.station}</span>
                      <span style={{fontSize:9,color:"#4a6070",marginLeft:"auto"}}>{row.n_days} days</span>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                      {[
                        ["σ (sigma)",   `${row.sigma_f?.toFixed(2)}°F`,  "#f0c070"],
                        ["MAE",         `${row.mae_f?.toFixed(2)}°F`,    "#80c8e0"],
                        ["σ (tight)",   `${row.sigma_tight?.toFixed(2)}°F`, "#00ff8c"],
                        ["σ (wide)",    `${row.sigma_wide?.toFixed(2)}°F`,  "#e07888"],
                      ].map(([l,v,col])=>(
                        <div key={l} style={{background:"#07090c",padding:"8px 10px",borderRadius:4}}>
                          <div style={{fontSize:8,color:"#8ab8c8",marginBottom:3,letterSpacing:".1em"}}>{l}</div>
                          <div style={{fontSize:13,color:col,fontWeight:500}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{fontSize:9,color:"#8ab8c8",marginBottom:2}}>
                      Within 2°F: <span style={{color:"#00ff8c"}}>{row.pct_within_2f?.toFixed(0)}%</span>
                      {" · "}Within 3°F: <span style={{color:"#00a858"}}>{row.pct_within_3f?.toFixed(0)}%</span>
                    </div>
                    <div style={{fontSize:9,color:"#4a6070"}}>Bias: {row.bias_f>=0?"+":""}{row.bias_f?.toFixed(2)}°F</div>
                  </div>
                );
              })}
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
      `}</style>

      {/* TOP BAR */}
      <div style={{background:"#070a0d",borderBottom:"1px solid #0c1c28",padding:"9px 22px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:apiError?"#ff4455":"#00ff8c",boxShadow:apiError?"0 0 9px #ff4455":"0 0 9px #00ff8c"}} className="pulse"/>
            <span style={{fontWeight:500,fontSize:13,color:apiError?"#ff4455":"#00ff8c",letterSpacing:".14em"}}>POLYBOT</span>
            <span style={{fontSize:9,color:"#8ab8c8",letterSpacing:".14em",marginLeft:4}}>WEATHER</span>
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
            {l:"TOTAL P&L",v:`${sign(portfolio.total_pnl)}${fmt$(portfolio.total_pnl)}`,c:portfolio.total_pnl>=0?"#00ff8c":"#ff4455"},
            {l:"WIN RATE", v:fmtPct(portfolio.win_rate),c:"#f0c070"},
            {l:"TRADES",   v:`${portfolio.total_trades}`,c:"#80c8e0"},
            {l:"OPEN",     v:`${portfolio.open_positions}`,c:"#00ff8c"},
          ].map(({l,v,c})=>(
            <div key={l} style={{textAlign:"right"}}>
              <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".16em",marginBottom:2}}>{l}</div>
              <div style={{fontSize:12,color:c,fontWeight:500}}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"220px 1fr 320px",height:"calc(100vh - 46px)"}}>
        {/* LEFT PANEL — SCANNER + CALIBRATION */}
        <div style={{background:"#070a0d",borderRight:"1px solid #0c1c28",padding:"14px 11px",overflowY:"auto",display:"flex",flexDirection:"column",gap:10}}>
          <div>
            <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".2em",marginBottom:6}}>SCANNER</div>
            <div style={{padding:"8px 10px",border:"1px solid #0c1c28",borderRadius:4,background:"#08090c"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:scanner.status==="running"?"#00ff8c":scanner.status==="stale"?"#f0c070":"#304858",boxShadow:scanner.status==="running"?"0 0 4px #00ff8c":"none"}} className={scanner.status==="running"?"pulse":""}/>
                <span style={{fontSize:8,color:scanner.status==="running"?"#00cc70":scanner.status==="stale"?"#f0c070":"#c8d8e0",letterSpacing:".1em",fontWeight:600}}>{scanner.status?.toUpperCase()}</span>
              </div>
              <div style={{fontSize:8,color:"#c8d8e0",lineHeight:1.4}}>{scanner.message}</div>
            </div>
          </div>

          <div>
            <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".2em",marginBottom:6}}>RISK ENGINE</div>
            {[
              ["Kelly",    "25%"],
              ["Max Bet",  "2% bal"],
              ["Open Pos", `${portfolio.open_positions}`],
              ["ROI",      `${sign(portfolio.roi_pct)}${portfolio.roi_pct?.toFixed(1)}%`],
            ].map(([l,v])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid #09090d"}}>
                <span style={{fontSize:7,color:"#c8d8e0"}}>{l}</span>
                <span style={{fontSize:7,fontWeight:700,color:v.startsWith("-")?"#ff4455":"#00ff8c"}}>{v}</span>
              </div>
            ))}
          </div>

          <div>
            <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".2em",marginBottom:6}}>CALIBRATION · 4 CITIES</div>
            {calibration.map(row=><CalibrationRow key={row.city} row={row}/>)}
          </div>

          <div>
            <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".2em",marginBottom:6}}>CITY P&L</div>
            {cityStats.map(s=>{
              const c = CITIES[s.city]||{color:"#8ab8c8"};
              return (
                <div key={s.city} style={{display:"flex",justifyContent:"space-between",padding:"4px 6px",borderBottom:"1px solid #0a0c10",fontSize:7}}>
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    <div style={{width:3,height:3,borderRadius:"50%",background:c.color}}/>
                    <span style={{color:"#c8d8e0",fontWeight:600}}>{s.city}</span>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <span style={{color:"#80c8e0"}}>{s.total}t</span>
                    <span style={{color:s.win_rate>=0.5?"#00a858":"#ff4455"}}>{fmtPct(s.win_rate)}</span>
                    <span style={{color:s.pnl>=0?"#00a858":"#ff4455"}}>{sign(s.pnl)}{fmt$(s.pnl)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* CENTER */}
        <div style={{display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {/* Chart */}
          <div style={{background:"#090c10",borderBottom:"1px solid #0c1c28",padding:"13px 18px",flexShrink:0}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:8,color:"#8ab8c8",letterSpacing:".2em"}}>P&L</span>
                <div style={{display:"flex",gap:2,background:"#0a0d12",border:"1px solid #0c1c28",borderRadius:4,padding:"2px"}}>
                  {TIMEFRAMES.map((t,i)=>(
                    <button key={t.label} className="tf-btn" onClick={()=>setTfIdx(i)} style={{color:tfIdx===i?"#00ff8c":"#4a6070",background:tfIdx===i?"#0a1e14":"none",border:tfIdx===i?"1px solid #00ff8c22":"1px solid transparent",fontWeight:tfIdx===i?500:400}}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{display:"flex",gap:14,alignItems:"center"}}>
                <span style={{fontSize:12,color:pd>=0?"#00ff8c":"#ff4455",fontWeight:500}}>{sign(pd)}{fmt$(Math.abs(pd))}</span>
                <span style={{fontSize:11,color:"#c8d8e0"}}>{sign(pd)}{(Math.abs(pd/1000)*100).toFixed(2)}%</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={80}>
              <LineChart data={filteredPnl} margin={{top:2,right:2,bottom:0,left:0}}>
                <defs><linearGradient id="lg2" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#006840"/><stop offset="100%" stopColor="#00ff8c"/></linearGradient></defs>
                <XAxis dataKey="time" tick={{fill:"#8ab8c8",fontSize:8}} axisLine={false} tickLine={false} interval={Math.max(1,Math.floor(filteredPnl.length/5))}/>
                <YAxis tick={{fill:"#8ab8c8",fontSize:8}} axisLine={false} tickLine={false} width={44} tickFormatter={v=>`$${v.toFixed(0)}`} domain={["auto","auto"]}/>
                <Tooltip contentStyle={{background:"#0b0e14",border:"1px solid #0c1c28",borderRadius:3,fontSize:10}} labelStyle={{color:"#c8d8e0"}} itemStyle={{color:"#00ff8c"}} formatter={v=>[fmt$(v),"Balance"]}/>
                <ReferenceLine y={p0} stroke="#8ab8c8" strokeDasharray="3 3"/>
                <Line type="monotone" dataKey={chartKey} stroke="url(#lg2)" strokeWidth={1.5} dot={false} activeDot={{r:3,fill:"#00ff8c"}}/>
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Desktop tabs */}
          <div style={{display:"flex",borderBottom:"1px solid #0c1c28",background:"#070a0d",flexShrink:0}}>
            {[["signals",signals.length],["trades",results.length],["calibration",calibration.length]].map(([t,n])=>(
              <button key={t} className="tb" onClick={()=>setDesktopTab(t)} style={{padding:"8px 16px",fontSize:9,letterSpacing:".12em",color:desktopTab===t?"#00ff8c":"#8ab8c8",borderBottom:desktopTab===t?"2px solid #00ff8c":"2px solid transparent",marginBottom:-1,transition:"color .15s"}}>
                {t.toUpperCase()} <span style={{marginLeft:5,fontSize:8,color:desktopTab===t?"#009860":"#c8d8e0"}}>{n}</span>
              </button>
            ))}
          </div>

          <div style={{flex:1,overflowY:"auto"}}>
            {/* SIGNALS TABLE */}
            {desktopTab==="signals"&&(signals.length===0?<div style={{padding:"40px",textAlign:"center",color:"#8ab8c8",fontSize:11}}>No edge candidates. Scanner running every 5–60 min.</div>:(
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:9}}>
                <thead style={{background:"#070a0d",position:"sticky",top:0}}>
                  <tr>{["CITY","BUCKET","DIR","MODEL %","MKT $","EDGE","MODELS","LEAD","STAKE"].map(h=>(<th key={h} style={{padding:"6px 10px",textAlign:"left",color:"#8ab8c8",fontSize:7,letterSpacing:".12em",fontWeight:400,borderBottom:"1px solid #0c1c28",whiteSpace:"nowrap"}}>{h}</th>))}</tr>
                </thead>
                <tbody>{signals.slice(0,80).map((s,i)=>(
                  <tr key={i} className="rh" style={{borderBottom:"1px solid #07080b"}}>
                    <td style={{padding:"8px 10px"}}><CityBadge city={s.city}/></td>
                    <td style={{padding:"8px 10px",color:"#fff",fontWeight:500}}>{s.bucket}</td>
                    <td style={{padding:"8px 10px"}}><DirectionBadge dir={s.direction}/></td>
                    <td style={{padding:"8px 10px",color:"#80c8e0"}}>{fmtPct(s.ensemble_prob)}</td>
                    <td style={{padding:"8px 10px",color:"#c8d8e0"}}>{s.market_price?.toFixed(3)}</td>
                    <td style={{padding:"8px 10px",color:"#00ff8c",fontWeight:600}}>+{fmtPct(s.edge)}</td>
                    <td style={{padding:"8px 10px",color:s.n_models_agree>=3?"#00ff8c":"#f0c070"}}>{s.n_models_agree}/4</td>
                    <td style={{padding:"8px 10px",color:"#8ab8c8"}}>{s.lead_hours?.toFixed(1)}h</td>
                    <td style={{padding:"8px 10px",color:"#f0c070",fontWeight:500}}>{fmt$(s.size_usd)}</td>
                  </tr>
                ))}</tbody>
              </table>
            ))}

            {/* TRADES TABLE */}
            {desktopTab==="trades"&&(results.length===0?<div style={{padding:"40px",textAlign:"center",color:"#8ab8c8",fontSize:11}}>No resolved trades yet. Waiting for first resolution.</div>:(
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:9}}>
                <thead style={{background:"#070a0d",position:"sticky",top:0}}>
                  <tr>{["DATE","CITY","BUCKET","DIR","MODEL %","MKT","ACTUAL","RESULT","P&L"].map(h=>(<th key={h} style={{padding:"6px 10px",textAlign:"left",color:"#8ab8c8",fontSize:7,letterSpacing:".12em",fontWeight:400,borderBottom:"1px solid #0c1c28",whiteSpace:"nowrap"}}>{h}</th>))}</tr>
                </thead>
                <tbody>{results.slice(0,80).map((t,i)=>(
                  <tr key={i} className="rh" style={{borderBottom:"1px solid #07080b"}}>
                    <td style={{padding:"8px 10px",color:"#8ab8c8",whiteSpace:"nowrap"}}>{t.target_date}</td>
                    <td style={{padding:"8px 10px"}}><CityBadge city={t.city}/></td>
                    <td style={{padding:"8px 10px",color:"#fff"}}>{t.bucket}</td>
                    <td style={{padding:"8px 10px"}}><DirectionBadge dir={t.direction}/></td>
                    <td style={{padding:"8px 10px",color:"#80c8e0"}}>{fmtPct(t.ensemble_prob)}</td>
                    <td style={{padding:"8px 10px",color:"#c8d8e0"}}>{t.market_price?.toFixed(3)}</td>
                    <td style={{padding:"8px 10px",color:"#c8d8e0"}}>{t.actual_high?.toFixed(1)}°F</td>
                    <td style={{padding:"8px 10px"}}>
                      <span style={{fontSize:8,padding:"2px 6px",borderRadius:2,background:t.won?"#002010":"#200010",color:t.won?"#00a858":"#ff4455",fontWeight:600}}>{t.won?"WON":"LOST"}</span>
                    </td>
                    <td style={{padding:"8px 10px",fontWeight:500,color:(t.pnl||0)>=0?"#00a858":"#ff4455"}}>{sign(t.pnl||0)}{fmt$(t.pnl||0)}</td>
                  </tr>
                ))}</tbody>
              </table>
            ))}

            {/* CALIBRATION TABLE */}
            {desktopTab==="calibration"&&(
              <div style={{padding:"16px"}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  {calibration.map(row=>{
                    const c = CITIES[row.city] || {color:"#8ab8c8",label:row.city,station:""};
                    return (
                      <div key={row.city} style={{background:"#0a0d12",border:"1px solid #0c1c28",borderLeft:`3px solid ${c.color}`,borderRadius:4,padding:"14px 16px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                          <span style={{fontSize:14,color:"#fff",fontWeight:500}}>{c.label}</span>
                          <span style={{fontSize:9,color:c.color,background:c.color+"18",padding:"2px 7px",borderRadius:3}}>{c.station}</span>
                          <span style={{fontSize:9,color:"#4a6070",marginLeft:"auto"}}>{row.n_days} days</span>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:10}}>
                          {[
                            ["σ",      `${row.sigma_f?.toFixed(2)}°F`,    "#f0c070"],
                            ["MAE",    `${row.mae_f?.toFixed(2)}°F`,      "#80c8e0"],
                            ["σ tight",`${row.sigma_tight?.toFixed(2)}°F`,"#00ff8c"],
                            ["σ wide", `${row.sigma_wide?.toFixed(2)}°F`, "#e07888"],
                          ].map(([l,v,col])=>(
                            <div key={l} style={{background:"#07090c",padding:"8px 10px",borderRadius:3}}>
                              <div style={{fontSize:7,color:"#8ab8c8",marginBottom:3,letterSpacing:".12em"}}>{l}</div>
                              <div style={{fontSize:12,color:col,fontWeight:500}}>{v}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:"#8ab8c8"}}>
                          <span>Bias: <span style={{color:row.bias_f>=0?"#f0c070":"#80c8e0"}}>{row.bias_f>=0?"+":""}{row.bias_f?.toFixed(2)}°F</span></span>
                          <span>≤2°F: <span style={{color:"#00ff8c"}}>{row.pct_within_2f?.toFixed(0)}%</span></span>
                          <span>≤3°F: <span style={{color:"#00a858"}}>{row.pct_within_3f?.toFixed(0)}%</span></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{marginTop:16,padding:"12px 14px",background:"#0a0d12",border:"1px solid #0c1c28",borderRadius:4}}>
                  <div style={{fontSize:8,color:"#8ab8c8",letterSpacing:".18em",marginBottom:6}}>WHAT THIS MEANS</div>
                  <div style={{fontSize:10,color:"#c8d8e0",lineHeight:1.6}}>
                    <span style={{color:"#f0c070"}}>σ tight</span> is the forecast error when all 3 models (GFS, ECMWF, ICON) agree within 2°F.
                    {" "}<span style={{color:"#e07888"}}>σ wide</span> is the error when they disagree. The ratio is your edge — wider the gap, bigger the trading opportunity.
                    {" "}The scanner only fires YES trades when 3+ models agree.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — ACTIVITY */}
        <div style={{background:"#070a0d",borderLeft:"1px solid #0c1c28",display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",borderBottom:"1px solid #0c1c28",flexShrink:0}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:newActivity?"#00ff8c":"#304858",boxShadow:newActivity?"0 0 7px #00ff8c":"none",transition:"all .3s"}} className={newActivity?"pulse":""}/>
            <span style={{fontSize:8,color:"#8ab8c8",letterSpacing:".2em"}}>ACTIVITY FEED</span>
            <span style={{fontSize:8,color:"#304858"}}>· every 5s</span>
          </div>
          <div ref={activityRef} style={{overflowY:"auto",flex:1,minHeight:0,padding:"4px 0"}}>
            {activity.length===0?(
              <div style={{padding:"16px 14px",color:"#304858",fontSize:10,textAlign:"center"}}>Waiting for activity...</div>
            ):activity.map((log,i)=>{
              const et=ET[log.event_type]||ET.SCANNING;
              return(
                <div key={log.id} className={i===0&&newActivity?"flashrow":""} style={{padding:"6px 10px",borderBottom:"1px solid #0a0c10"}}>
                  <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:1}}>
                    <span style={{fontSize:6,padding:"1px 4px",borderRadius:2,background:et.color+"18",color:et.color,whiteSpace:"nowrap",flexShrink:0,fontWeight:700}}>{et.icon} {et.label}</span>
                    <span style={{fontSize:6,color:"#243848",flexShrink:0}}>{log.logged_at?new Date(log.logged_at).toLocaleTimeString("en-US",{timeZone:"America/Los_Angeles",hour:"2-digit",minute:"2-digit"}):""}</span>
                    <span style={{fontSize:6,color:"#243848",marginLeft:"auto",flexShrink:0}}>{log.time_ago}</span>
                  </div>
                  {log.market&&<div style={{fontSize:8,color:"#8ab8c8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:1,fontWeight:600}}>{log.market}</div>}
                  <div style={{fontSize:8,color:et.color==="#4a5868"?"#506070":"#c8d8e0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{log.message}</div>
                  {log.detail&&<div style={{fontSize:7,color:"#3a5060",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginTop:1}}>{log.detail}</div>}
                </div>
              );
            })}
          </div>
          <div style={{padding:"10px 12px",borderTop:"1px solid #0c1c28",flexShrink:0}}>
            <div style={{fontSize:7,color:"#4a6070",letterSpacing:".18em",marginBottom:8}}>OPEN SIGNALS BY CITY</div>
            {CITY_LIST.map(city=>{
              const stat = cityStats.find(s=>s.city===city) || {open_count:0,open_stake:0};
              const c = CITIES[city];
              const max = Math.max(...cityStats.map(s=>s.open_count||0), 1);
              return (
                <div key={city} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                  <span style={{fontSize:7,color:"#c8d8e0",width:50,flexShrink:0}}>{city}</span>
                  <div style={{flex:1,height:3,background:"#0c1c28",borderRadius:2}}>
                    <div style={{width:`${(stat.open_count/max)*100}%`,height:3,background:c.color,borderRadius:2}}/>
                  </div>
                  <span style={{fontSize:7,color:c.color,width:22,textAlign:"right",flexShrink:0,fontWeight:600}}>{stat.open_count}</span>
                  <span style={{fontSize:7,color:"#8ab8c8",width:40,textAlign:"right",flexShrink:0}}>{fmt$(stat.open_stake)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
