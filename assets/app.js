(() => {
	"use strict";

	const state = {
		json: null,
		charactersById: {},
		messages: [],
		userMessages: [],
		assistantByUserIdAndModel: new Map(),
		models: [], // [{key, name, shortName, provider, iconUrl, summary}]
		selectedModelKey: null
	};

	const els = {};

	window.addEventListener("DOMContentLoaded", () => {
		els.fileInput = document.getElementById("file-input");
		els.exportBtn = document.getElementById("export-btn");
		els.modelList = document.getElementById("model-list");
		els.modelSummary = document.getElementById("model-summary");
		els.chat = document.getElementById("chat");
		els.placeholder = document.getElementById("placeholder");
		els.dropZone = document.getElementById("drop-zone");

		els.fileInput.addEventListener("change", onPickFile);
		els.exportBtn.addEventListener("click", onExport);
		// status (ヘッダー内のシンプル表示)
		els.statusBar = document.getElementById("status-bar");
		els.statusDot = document.getElementById("status-dot");
		els.statusText = document.getElementById("status-text");
		setupDnd();
	});

	function setupDnd(){
		const dz = els.dropZone;
		["dragenter","dragover"].forEach(evt => dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.add("drag"); }));
		["dragleave","drop"].forEach(evt => dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.remove("drag"); }));
		dz.addEventListener("drop", e => {
			const file = e.dataTransfer.files?.[0];
			if(file){ readFile(file); }
		});
	}

	function onPickFile(e){
		const file = e.target.files?.[0];
		if(file){ readFile(file); }
	}

	function readFile(file){
		const reader = new FileReader();
		beginStage("ファイル読込中", 5);
		reader.onerror = () => {
			failStage("JSONの読み込みに失敗しました。");
			alert("JSONの読み込みに失敗しました。");
		};
		reader.onload = () => {
			try{
				advanceStage("JSON解析中");
				const json = JSON.parse(String(reader.result));
				advanceStage("インデックス作成");
				loadJson(json);
			}catch(err){
				console.error(err);
				failStage("JSONのパースに失敗しました。");
				alert("JSONのパースに失敗しました。");
			}
		};
		reader.readAsText(file);
	}

	function loadJson(json){
		state.json = json;
		advanceStage("インデックス作成");
		indexData(json);
		advanceStage("UIレンダリング");
		renderModels();
		if(state.models.length > 0){
			selectModel(state.models[0].key);
		}
		els.exportBtn.disabled = false;
		els.placeholder.hidden = true;
		els.chat.hidden = false;
		document.title = json.title ? `${json.title} - OpenRouter Chat Viewer` : document.title;
		endStage("完了");
	}

	function indexData(json){
		state.charactersById = json.characters || {};
		state.messages = Object.values(json.messages || {});
		state.messages.sort((a,b) => {
			const ta = Date.parse(a.createdAt || 0) || 0;
			const tb = Date.parse(b.createdAt || 0) || 0;
			if(ta !== tb) return ta - tb;
			return String(a.id).localeCompare(String(b.id));
		});

		state.userMessages = state.messages.filter(m => m.type === "user" || m.characterId === "USER");

		// userId -> modelKey -> assistantMsg
		state.assistantByUserIdAndModel = new Map();
		const modelSet = new Map(); // key -> {name, shortName, provider, iconUrl}

		for(const msg of state.messages){
			if(msg.type !== "assistant") continue;
			const userId = msg.parentMessageId || null;
			if(!userId) continue;
			const modelKey = deriveModelKey(msg);
			if(!modelKey) continue;

			if(!state.assistantByUserIdAndModel.has(userId)){
				state.assistantByUserIdAndModel.set(userId, new Map());
			}
			state.assistantByUserIdAndModel.get(userId).set(modelKey, msg);

			const char = state.charactersById[msg.characterId] || {};
			const modelInfo = char.modelInfo || {};
			const endpoint = char.endpoint || {};
			const providerInfo = (endpoint.provider_info) || {};
			const name = modelInfo.name || modelKey;
			const shortName = modelInfo.short_name || modelKey;
			const provider = (modelKey && String(modelKey).split("/")[0]) || providerInfo.name || endpoint.provider_name || msg.metadata?.provider || "";
			const iconUrl = providerInfo.icon?.url || "";
			modelSet.set(modelKey, { name, shortName, provider, iconUrl });
		}

		// build model list with summary
		state.models = Array.from(modelSet.entries()).map(([key, meta]) => ({ key, ...meta, summary: summarizeModel(key) }));
		state.models.sort((a,b) => a.name.localeCompare(b.name));
	}

	function deriveModelKey(msg){
		return msg.metadata?.variantSlug
			|| state.charactersById[msg.characterId]?.modelInfo?.slug
			|| state.charactersById[msg.characterId]?.model
			|| null;
	}

	function summarizeModel(modelKey){
		let totalCost = 0, totalTokens = 0, count = 0, totalReasoningMs = 0;
		for(const msg of state.messages){
			if(msg.type !== "assistant") continue;
			const key = deriveModelKey(msg);
			if(key !== modelKey) continue;
			count++;
			const cost = Number(msg.metadata?.cost || 0);
			if(!Number.isNaN(cost)) totalCost += cost;
			const tokens = Number(msg.metadata?.tokensCount || 0);
			if(!Number.isNaN(tokens)) totalTokens += tokens;
			const r = Number(msg.metadata?.reasoningDuration || 0);
			if(!Number.isNaN(r)) totalReasoningMs += r;
		}
		return { totalCost, totalTokens, count, totalReasoningMs };
	}

	function renderModels(){
		els.modelList.innerHTML = "";
		for(const model of state.models){
			const li = document.createElement("li");
			li.className = "model-item";
			li.dataset.key = model.key;
			li.innerHTML = `
				<div class="model-name">${escapeHtml(model.shortName || model.name)}</div>
				<div class="model-meta">${escapeHtml(model.provider || "")}</div>
			`;
			li.addEventListener("click", () => selectModel(model.key));
			els.modelList.appendChild(li);
		}
	}

	function selectModel(modelKey){
		state.selectedModelKey = modelKey;
		for(const item of els.modelList.querySelectorAll(".model-item")){
			item.classList.toggle("selected", item.dataset.key === modelKey);
		}
		renderModelSummary();
		renderChat();
	}

	function renderModelSummary(){
		const model = state.models.find(m => m.key === state.selectedModelKey);
		if(!model){ els.modelSummary.textContent = ""; return; }
		const s = model.summary;
		els.modelSummary.innerHTML = `
			<div class="summary-grid">
				<div class="card"><div>総コスト</div><div><strong>$${formatCost(s.totalCost)}</strong></div></div>
				<div class="card"><div>トークン</div><div><strong>${s.totalTokens.toLocaleString()}</strong></div></div>
				<div class="card"><div>応答数</div><div><strong>${s.count}</strong></div></div>
				<div class="card"><div>推論時間</div><div><strong>${formatMs(s.totalReasoningMs)}</strong></div></div>
			</div>
		`;
	}

	function renderChat(){
		els.chat.innerHTML = "";
		const selected = state.selectedModelKey;
		for(const umsg of state.userMessages){
			els.chat.appendChild(renderUserMessage(umsg));
			const perModel = state.assistantByUserIdAndModel.get(umsg.id);
			const amsg = perModel?.get(selected);
			if(amsg){
				els.chat.appendChild(renderAssistantMessage(amsg));
			}
		}
	}

	// ---------- Status & Logging ----------
	let totalStages = 0; let currentStage = 0;
	function beginStage(text, stages){
		try{ totalStages = stages || 5; currentStage = 0; showStatus(true); setStatus(text, 0); }catch{}
	}
	function advanceStage(text){
		try{ currentStage = Math.min(totalStages, currentStage + 1); const pct = Math.round(currentStage/totalStages*100); setStatus(text, pct); }catch{}
	}
	function endStage(text){ setStatus(text||"完了", 100); setTimeout(() => showStatus(false), 1200); }
	function failStage(text){ setStatus(text||"失敗", 100, true); }
	function setStatus(text, percent, isError){
		if(!els.statusBar) return;
		els.statusBar.removeAttribute("hidden");
		els.statusText.textContent = text;
		els.statusDot.classList.toggle("active", !isError);
	}
	function showStatus(show){ if(!els.statusBar) return; if(show) els.statusBar.removeAttribute("hidden"); else els.statusBar.setAttribute("hidden", ""); }

	function renderUserMessage(msg){
		const el = document.createElement("div");
		el.className = "msg user";
		el.innerHTML = `
			<div class="avatar">You</div>
			<div class="bubble">
				<div class="msg-header">
					<div class="name">ユーザー</div>
					<div class="meta">${fmtDate(msg.createdAt)}</div>
				</div>
				<div class="md">${renderMarkdown(msg.content || "")}</div>
				${renderAttachments(msg.attachments || [])}
			</div>
		`;
		return el;
	}

	function renderAssistantMessage(msg){
		const el = document.createElement("div");
		el.className = "msg assistant";
		const name = state.charactersById[msg.characterId]?.modelInfo?.short_name
			|| state.charactersById[msg.characterId]?.modelInfo?.name
			|| deriveModelKey(msg)
			|| "assistant";
		const tokens = Number(msg.metadata?.tokensCount || 0);
		const cost = Number(msg.metadata?.cost || 0);
		const rdur = Number(msg.metadata?.reasoningDuration || 0);
		const mk = deriveModelKey(msg);
		const provider = (mk && mk.split("/")[0]) || state.charactersById[msg.characterId]?.endpoint?.provider_name || msg.metadata?.provider || "";
		const hasReasoning = !!msg.reasoning;
		el.innerHTML = `
			<div class="avatar">AI</div>
			<div class="bubble">
				<div class="msg-header">
					<div class="name">${escapeHtml(name)}</div>
					<div class="meta">${escapeHtml(provider)} ・ ${tokens? (tokens.toLocaleString()+" tok") : ""} ・ ${cost? ("$"+formatCost(cost)) : ""} ・ ${rdur? formatMs(rdur):""}</div>
				</div>
				${hasReasoning ? `<div class="thinking"><details><summary>Thinking を表示</summary><div class="note">内部思考（参考表示・初期は非表示）</div><div class="md">${renderMarkdown(msg.reasoning)}</div></details></div>` : ""}
				<div class="md">${renderMarkdown(msg.content || "")}</div>
				${renderAttachments(msg.attachments || [])}
			</div>
		`;
		return el;
	}

	function renderAttachments(arr){
		if(!arr || arr.length === 0) return "";
		const items = arr.map(a => renderAttachment(a)).join("");
		return `<div class="attachments">${items}</div>`;
	}

	function renderAttachment(att){
		const dataUrl = att.content || "";
		const name = att.name || "file";
		const mime = parseDataUrlMime(dataUrl) || guessMimeFromName(name) || "application/octet-stream";
		if(mime.startsWith("image/")){
			return `<div class="attachment"><div>${escapeHtml(name)}</div><img src="${dataUrl}" alt="${escapeHtml(name)}"></div>`;
		}
		if(mime === "application/pdf"){
			return `<div class="attachment"><details><summary>${escapeHtml(name)}（PDF プレビュー）</summary><object data="${dataUrl}" type="application/pdf"></object><div style="margin-top:6px"><a href="${dataUrl}" download="${escapeAttr(name)}">ダウンロード</a></div></details></div>`;
		}
		return `<div class="attachment"><div>${escapeHtml(name)}</div><a href="${dataUrl}" download="${escapeAttr(name)}">ダウンロード</a></div>`;
	}

	function onExport(){
		if(!state.json){ return; }
		const html = buildStandaloneHtml(state.json);
		const blob = new Blob([html], { type: "text/html;charset=utf-8" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = toSlug(state.json.title || "chat") + ".html";
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 2000);
	}

	function buildStandaloneHtml(json){
		const css = STANDALONE_CSS.trim();
		const js = STANDALONE_JS.trim();
		const title = (json.title ? escapeHtml(json.title) + " - " : "") + "OpenRouter Chat Viewer";
		const data = JSON.stringify(json);
		return `<!doctype html>
		<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
		<style>${css}</style>
		<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
		<script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js"></script>
		</head>
		<body>
		<header class="app-header"><div class="branding">OpenRouter Chat Viewer</div>
		<div class="controls"><button id="export-btn" disabled>HTMLをダウンロード</button></div></header>
		<main class="app"><aside class="sidebar"><h2>モデル</h2><ul id="model-list" class="model-list"></ul><div id="model-summary" class="model-summary"></div></aside>
		<section class="content"><div id="chat" class="chat"></div></section></main>
		<script>window.__EXPORTED_JSON__=${data}</script>
		<script>${js}</script>
		</body></html>`;
	}

	function renderMarkdown(md){
		if(!md) return "";
		try{
			const html = window.marked.parse(md, { mangle:false, headerIds:false });
			return DOMPurify.sanitize(html);
		}catch(e){ return `<pre>${escapeHtml(md)}</pre>`; }
	}

	function escapeHtml(str){
		return String(str).replace(/[&<>"']/g, s => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[s]));
	}
	function escapeAttr(str){ return escapeHtml(str).replace(/"/g, '&quot;'); }
	function formatCost(n){ return (Number(n)||0).toFixed(6); }
	function formatMs(ms){ if(!ms) return ""; const s = (ms/1000).toFixed(1); return `${s}s`; }
	function fmtDate(iso){ if(!iso) return ""; try{ const d = new Date(iso); return d.toLocaleString(); }catch{ return ""; } }
	function parseDataUrlMime(dataUrl){ const m = /^data:([^;,]+)[;,]/.exec(dataUrl||""); return m? m[1] : null; }
	function guessMimeFromName(name){ if(/\.pdf$/i.test(name)) return "application/pdf"; if(/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(name)) return "image/*"; return null; }
	function toSlug(s){ return String(s).trim().toLowerCase().replace(/[^a-z0-9\-\_]+/g,'-').replace(/-+/g,'-').replace(/^-|-$|_/g,''); }

	// ---------- Standalone assets (inline for export) ----------
	const STANDALONE_CSS = `
	:root{--bg:#0b0f14;--bg-elev:#121821;--text:#e7eef7;--muted:#a9b4c0;--brand:#4cc2ff;--accent:#7bf1a8;--border:#22303f;--chip:#1b2430}
	*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji"}
	.app-header{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--bg-elev)}
	.branding{font-weight:700;letter-spacing:.2px}.controls{display:flex;gap:8px;align-items:center}
	button{background:var(--brand);color:#001018;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;font-weight:600}button:disabled{opacity:.5;cursor:not-allowed}
	.app{display:grid;grid-template-columns:280px 1fr;min-height:calc(100vh - 52px)}
	.sidebar{border-right:1px solid var(--border);padding:12px;background:var(--bg-elev)}
	.sidebar h2{margin:8px 0 12px 0;font-size:13px;color:var(--muted);letter-spacing:.4px}
	.model-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px}
	.model-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px;border:1px solid var(--border);background:var(--chip);border-radius:10px;cursor:pointer}
	.model-item:hover{outline:1px solid var(--brand)}.model-item.selected{outline:2px solid var(--brand)}
	.model-name{font-weight:600}.model-meta{color:var(--muted);font-size:12px}
	.model-summary{margin-top:12px;border-top:1px solid var(--border);padding-top:12px;font-size:13px}
	.summary-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.summary-grid .card{background:var(--chip);border:1px solid var(--border);border-radius:8px;padding:8px}
	.content{padding:0}.chat{display:flex;flex-direction:column;gap:16px;padding:16px}
	.msg{display:flex;gap:12px}.avatar{width:28px;height:28px;border-radius:50%;background:#1e2a38;display:inline-flex;align-items:center;justify-content:center;font-size:12px;color:var(--muted)}
	.bubble{flex:1;background:var(--bg-elev);border:1px solid var(--border);border-radius:12px;padding:12px}
	.msg.user .bubble{border-left:3px solid var(--accent)}.msg.assistant .bubble{border-left:3px solid var(--brand)}
	.msg-header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}.msg-header .name{font-weight:700}.msg-header .meta{color:var(--muted);font-size:12px}
	.attachments{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}.attachment{background:var(--chip);border:1px solid var(--border);border-radius:8px;padding:8px;max-width:100%}
	.attachment img{max-width:360px;height:auto;display:block;border-radius:6px}.attachment details{max-width:720px}
	.attachment object,.attachment iframe{width:100%;height:480px;border:none;background:#fff}
	.md pre{background:#0a0f16;border:1px solid var(--border);padding:10px;border-radius:8px;overflow:auto}
	.md code{background:#0a0f16;padding:2px 4px;border-radius:4px}.md table{border-collapse:collapse;width:100%;display:block;overflow:auto}
	.md th,.md td{border:1px solid var(--border);padding:6px 8px}.thinking{margin-top:10px}.thinking .note{color:var(--muted);font-size:12px}
	@media (max-width:900px){.app{grid-template-columns:1fr}.sidebar{order:2}.content{order:1}}
	`;

	const STANDALONE_JS = '(function(){"use strict";var state={};function escapeHtml(s){return String(s).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];});}'
		+ 'function formatCost(n){return(Number(n)||0).toFixed(6);}function formatMs(ms){if(!ms)return"";return(ms/1000).toFixed(1)+"s";}'
		+ 'function parseMime(d){var m=/^data:([^;,]+)[;,]/.exec(d||"");return m?m[1]:null;}function guessMime(n){if(/\\.pdf$/i.test(n))return"application/pdf";if(/\\.(png|jpg|jpeg|gif|webp|svg)$/i.test(n))return"image/*";return null;}'
		+ 'function deriveKey(msg,chars){return(msg.metadata&&msg.metadata.variantSlug)||(chars[msg.characterId]&&chars[msg.characterId].modelInfo&&chars[msg.characterId].modelInfo.slug)||(chars[msg.characterId]&&chars[msg.characterId].model)||null;}'
		+ 'function mdToHtml(md){try{var html=window.marked.parse(md||"",{mangle:false,headerIds:false});return DOMPurify.sanitize(html);}catch(e){return"<pre>"+escapeHtml(md||"")+"</pre>";}}'
		+ 'function renderAttach(a){var data=a.content||"";var name=a.name||"file";var mime=parseMime(data)||guessMime(name)||"application/octet-stream";if(mime.startsWith("image/")){return"<div class=attachment><div>"+escapeHtml(name)+"</div><img src=\\""+data+"\\" alt=\\""+escapeHtml(name)+"\\"></div>";}if(mime==="application/pdf"){return"<div class=attachment><details><summary>"+escapeHtml(name)+"（PDF プレビュー）</summary><object data=\\""+data+"\\" type=\\"application/pdf\\"></object><div style=margin-top:6px><a href=\\""+data+"\\" download=\\""+escapeHtml(name)+"\\">ダウンロード</a></div></details></div>";}return"<div class=attachment><div>"+escapeHtml(name)+"</div><a href=\\""+data+"\\" download=\\""+escapeHtml(name)+"\\">ダウンロード</a></div>";}'
		+ 'function summarize(modelKey,msgs,chars){var totalCost=0,totalTokens=0,count=0,totalR=0;for(var i=0;i<msgs.length;i++){var m=msgs[i];if(m.type!=="assistant")continue;var k=deriveKey(m,chars);if(k!==modelKey)continue;count++;totalCost+=Number((m.metadata&&m.metadata.cost)||0)||0;totalTokens+=Number((m.metadata&&m.metadata.tokensCount)||0)||0;totalR+=Number((m.metadata&&m.metadata.reasoningDuration)||0)||0;}return{totalCost:totalCost,totalTokens:totalTokens,count:count,totalReasoningMs:totalR};}\n'
		+ 'function render(json){ state.json=json; const chars=json.characters||{}; const all=Object.values(json.messages||{}); all.sort(function(a,b){const ta=Date.parse(a.createdAt||0)||0; const tb=Date.parse(b.createdAt||0)||0; if(ta!==tb) return ta-tb; return String(a.id).localeCompare(String(b.id));}); const users=all.filter(function(m){return m.type==="user"||m.characterId==="USER";}); const map=new Map(); const models=new Map(); for(const m of all){ if(m.type!=="assistant") continue; const pid=m.parentMessageId; if(!pid) continue; const k=deriveKey(m, chars); if(!k) continue; if(!map.has(pid)) map.set(pid, new Map()); map.get(pid).set(k, m); const char=chars[m.characterId]||{}; const info=char.modelInfo||{}; const ep=char.endpoint||{}; const slug=k; const prov=(slug&&slug.split("/")[0]) || (ep.provider_name||"") || ((m.metadata&&m.metadata.provider)||""); models.set(k, {key:k, name:info.name||k, shortName:info.short_name||k, provider:prov}); }\n'
		+ '// sidebar\n'
		+ 'const list=document.getElementById("model-list"); list.innerHTML=""; const mlist=Array.from(models.values()).map(function(m){ return { key:m.key, name:m.name, shortName:m.shortName, provider:m.provider, summary:summarize(m.key, all, chars) }; }).sort(function(a,b){return a.name.localeCompare(b.name);}); const summaryEl=document.getElementById("model-summary"); let current=(mlist[0]&&mlist[0].key)||null; function paintSummary(){ const m=mlist.find(function(x){return x.key===current;}); if(!m){ summaryEl.textContent=""; return;} const s=m.summary; summaryEl.innerHTML="<div class=summary-grid><div class=card><div>総コスト</div><div><strong>$"+((Number(s.totalCost)||0).toFixed(6))+"</strong></div></div><div class=card><div>トークン</div><div><strong>"+s.totalTokens.toLocaleString()+"</strong></div></div><div class=card><div>応答数</div><div><strong>"+s.count+"</strong></div></div><div class=card><div>推論時間</div><div><strong>"+(((s.totalReasoningMs||0)/1000).toFixed(1))+"s</strong></div></div></div>"; }\n'
		+ 'function select(k){ current=k; Array.from(list.querySelectorAll(".model-item")).forEach(function(li){ li.classList.toggle("selected", li.dataset.key===k); }); paintSummary(); paint(); }\n'
		+ 'for(const m of mlist){ const li=document.createElement("li"); li.className="model-item"; li.dataset.key=m.key; li.innerHTML="<div class=model-name>"+escapeHtml(m.shortName||m.name)+"</div><div class=model-meta>"+escapeHtml(m.provider||"")+"</div>"; li.onclick=function(){ select(m.key); }; list.appendChild(li); }\n'
		+ '// chat\n'
		+ 'const chat=document.getElementById("chat"); function paint(){ chat.innerHTML=""; for(const u of users){ const uel=document.createElement("div"); uel.className="msg user"; uel.innerHTML="<div class=avatar>You</div><div class=bubble><div class=msg-header><div class=name>ユーザー</div><div class=meta>"+escapeHtml(u.createdAt||"")+"</div></div><div class=md>"+mdToHtml(u.content||"")+"</div>"+((u.attachments&&u.attachments.length)?"<div class=attachments>"+u.attachments.map(renderAttach).join("")+"</div>":"")+"</div>"; chat.appendChild(uel); const per=map.get(u.id); const a=(per&&per.get)? per.get(current): null; if(a){ const tokens=Number((a.metadata&&a.metadata.tokensCount)||0); const cost=Number((a.metadata&&a.metadata.cost)||0); const r=Number((a.metadata&&a.metadata.reasoningDuration)||0); const sk=deriveKey(a, chars); const prov=(sk&&sk.split("/")[0])||""; const name=(chars[a.characterId]&&chars[a.characterId].modelInfo&&chars[a.characterId].modelInfo.short_name)||(chars[a.characterId]&&chars[a.characterId].modelInfo&&chars[a.characterId].modelInfo.name)||deriveKey(a, chars)||"assistant"; const ael=document.createElement("div"); ael.className="msg assistant"; ael.innerHTML="<div class=avatar>AI</div><div class=bubble><div class=msg-header><div class=name>"+escapeHtml(name)+"</div><div class=meta>"+escapeHtml(prov)+" ・ "+(tokens?(tokens.toLocaleString()+" tok"):"")+" ・ "+(cost?("$"+(Number(cost)||0).toFixed(6)):"")+" ・ "+(r?(((r||0)/1000).toFixed(1)+"s"):"")+"</div></div>"+(a.reasoning?"<div class=thinking><details><summary>Thinking を表示</summary><div class=note>内部思考（参考表示・初期は非表示）</div><div class=md>"+mdToHtml(a.reasoning)+"</div></details></div>":"")+"<div class=md>"+mdToHtml(a.content||"")+"</div>"+((a.attachments&&a.attachments.length)?"<div class=attachments>"+a.attachments.map(renderAttach).join("")+"</div>":"")+"</div>"; chat.appendChild(ael);} } }\n'
		+ 'select(current);}'
		+ 'window.addEventListener("DOMContentLoaded",function(){if(window.__EXPORTED_JSON__){render(window.__EXPORTED_JSON__);}});'
		+ '})();';

	// ----------------------------------------------------------

	// Expose helpers (for debugging if needed)
	window.__orcv__ = { state };

})();


