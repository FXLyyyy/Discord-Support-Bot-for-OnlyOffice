import { Ticket, TicketMessage, TicketNote } from '../types';

const AVATAR_COLORS = [
  '#5865f2','#57f287','#faa81a','#eb459e','#ed4245',
  '#3ba55c','#fee75c','#9c84ec','#45ddc0','#f47b67',
];

function avatarColor(username: string): string {
  let h = 0;
  for (const c of username) h = (h << 5) - h + c.charCodeAt(0);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12: false });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
}

function fmtFull(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year:'numeric', month:'short', day:'numeric',
    hour:'2-digit', minute:'2-digit', hour12: false,
  });
}

export function generateTranscriptHtml(params: {
  ticket: Ticket;
  messages: TicketMessage[];
  notes?: TicketNote[];
  openedByTag: string;
  agentTag: string | null;
  guildName: string;
  /** When false, internal-only content (close reason, staff notes) is omitted. */
  includeInternal?: boolean;
}): string {
  const { ticket, messages, openedByTag, agentTag, guildName } = params;
  const includeInternal = params.includeInternal !== false;
  const notes = includeInternal ? (params.notes ?? []) : [];

  // Always show the original ticket submission at the top
  const submissionBlock = `
<div class="submission">
  <div class="sub-label">📋 TICKET SUBMITTED</div>
  <div class="sub-row"><span class="sub-key">Subject</span><span class="sub-val">${esc(ticket.subject)}</span></div>
  <div class="sub-row"><span class="sub-key">Description</span></div>
  <div class="sub-desc">${esc(ticket.description ?? '—')}</div>
</div>`;

  let body = submissionBlock;

  // Resolution (shared with the user) + internal close reason (staff-only)
  const showReason = includeInternal && ticket.close_reason;
  if (ticket.resolution || showReason) {
    body += `
<div class="submission resolution">
  <div class="sub-label">✅ RESOLUTION</div>`;
    if (ticket.resolution) {
      body += `<div class="sub-desc">${esc(ticket.resolution)}</div>`;
    }
    if (showReason) {
      body += `<div class="sub-row" style="margin-top:8px"><span class="sub-key">Reason</span><span class="sub-val">${esc(ticket.close_reason as string)}</span></div>`;
    }
    body += `</div>`;
  }

  // Internal staff notes (never shown to the user)
  if (notes.length > 0) {
    body += `
<div class="submission notes">
  <div class="sub-label">🗒️ INTERNAL NOTES (${notes.length})</div>`;
    for (const n of notes) {
      body += `
  <div class="note">
    <div class="note-head"><span class="note-author">${esc(n.author_tag)}</span><span class="ts">${fmtFull(n.created_at)}</span></div>
    <div class="note-body">${esc(n.note)}</div>
  </div>`;
    }
    body += `</div>`;
  }

  let lastUser = '';
  let lastDate = '';

  if (messages.length > 0) {
    body += '<div class="div">CONVERSATION</div>';
  }

  for (const msg of messages) {
    const d = fmtDate(msg.created_at);
    if (d !== lastDate) {
      body += `<div class="div">${esc(d)}</div>`;
      lastDate = d;
      lastUser = '';
    }

    const newGroup = msg.username !== lastUser;
    lastUser = msg.username;

    const atts = msg.attachments
      .map(a => `<a class="att" href="${esc(a.url)}" target="_blank">📎 ${esc(a.name)}</a>`)
      .join('');

    const textHtml = msg.content
      ? `<div class="mt">${esc(msg.content)}</div>`
      : '';

    if (newGroup) {
      const color = avatarColor(msg.username);
      const init = msg.username.slice(0, 2).toUpperCase();
      body += `
<div class="msg new">
  <div class="avc"><div class="av" style="background:${color}">${init}</div></div>
  <div class="cc">
    <div class="mh"><span class="un">${esc(msg.username)}</span><span class="ts">${fmtFull(msg.created_at)}</span></div>
    ${textHtml}${atts}
  </div>
</div>`;
    } else {
      body += `
<div class="msg">
  <div class="avc"><span class="ht">${fmtTime(msg.created_at)}</span></div>
  <div class="cc">${textHtml}${atts}</div>
</div>`;
    }
  }

  if (messages.length === 0) {
    body += '<div class="div">No chat messages recorded</div>';
  }

  const stars = ticket.rating ? '⭐'.repeat(ticket.rating) : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ticket #${ticket.ticket_number} — ${esc(ticket.subject)}</title>
<style>
:root{--bg:#313338;--bg2:#2b2d31;--bg3:#1e1f22;--t:#dbdee1;--t2:#949ba4;--mu:#6d6f78;--ac:#5865f2;--red:#f23f43;}
*{margin:0;padding:0;box-sizing:border-box;}
body{background:var(--bg);color:var(--t);font-family:'gg sans','Noto Sans',Whitney,Arial,sans-serif;font-size:14px;line-height:1.4;}
.hdr{background:var(--bg2);border-bottom:1px solid var(--bg3);padding:20px 32px;position:sticky;top:0;z-index:10;}
.htop{display:flex;align-items:center;gap:10px;margin-bottom:8px;}
h1{color:#fff;font-size:18px;font-weight:600;}
.badge{background:var(--red);color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:100px;text-transform:uppercase;}
.stars{font-size:13px;}
.meta{display:flex;flex-wrap:wrap;gap:16px;color:var(--t2);font-size:13px;}
.msgs{max-width:900px;margin:0 auto;padding:16px 24px;}
.div{display:flex;align-items:center;gap:12px;margin:16px 0;color:var(--mu);font-size:12px;font-weight:600;}
.div::before,.div::after{content:'';flex:1;height:1px;background:var(--bg3);}
.msg{display:flex;gap:16px;padding:2px 8px;border-radius:4px;}
.msg:hover{background:rgba(0,0,0,.07);}
.msg.new{margin-top:16px;}
.avc{width:40px;flex-shrink:0;padding-top:2px;}
.av{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;color:#fff;}
.ht{display:none;color:var(--mu);font-size:11px;padding-top:5px;text-align:right;width:40px;}
.msg:hover .ht{display:block;}
.cc{flex:1;min-width:0;}
.mh{display:flex;align-items:baseline;gap:8px;margin-bottom:2px;}
.un{font-weight:600;color:#fff;}
.ts{color:var(--mu);font-size:11px;}
.mt{white-space:pre-wrap;word-break:break-word;}
.att{display:inline-flex;align-items:center;gap:6px;margin-top:4px;padding:6px 10px;background:var(--bg2);border-radius:4px;border-left:3px solid var(--ac);color:#00aff4;font-size:13px;text-decoration:none;word-break:break-all;}
.att:hover{text-decoration:underline;}
.foot{text-align:center;color:var(--mu);font-size:12px;padding:32px;border-top:1px solid var(--bg3);margin-top:24px;}
.submission{background:var(--bg2);border:1px solid var(--bg3);border-left:3px solid var(--ac);border-radius:4px;padding:16px 20px;margin-bottom:8px;}
.sub-label{color:var(--ac);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;}
.sub-row{display:flex;gap:12px;margin-bottom:2px;}
.sub-key{color:var(--t2);font-size:13px;font-weight:600;min-width:80px;}
.sub-val{color:var(--t);font-size:13px;}
.sub-desc{color:var(--t);font-size:13px;white-space:pre-wrap;word-break:break-word;margin-top:8px;padding-top:8px;border-top:1px solid var(--bg3);}
.resolution{border-left-color:var(--green,#3ba55c);}
.resolution .sub-label{color:#3ba55c;}
.resolution .sub-desc{border-top:none;padding-top:0;}
.notes{border-left-color:#faa81a;}
.notes .sub-label{color:#faa81a;}
.note{margin-top:10px;padding-top:10px;border-top:1px solid var(--bg3);}
.note:first-of-type{border-top:none;}
.note-head{display:flex;align-items:baseline;gap:8px;margin-bottom:3px;}
.note-author{font-weight:600;color:#fff;font-size:13px;}
.note-body{color:var(--t);font-size:13px;white-space:pre-wrap;word-break:break-word;}
</style>
</head>
<body>
<div class="hdr">
  <div class="htop">
    <h1>Ticket #${ticket.ticket_number} — ${esc(ticket.subject)}</h1>
    <span class="badge">Closed</span>
    ${stars ? `<span class="stars">${stars} ${ticket.rating}/5</span>` : ''}
  </div>
  <div class="meta">
    <span>👤 ${esc(openedByTag)}</span>
    <span>📅 Opened ${fmtFull(ticket.created_at)}</span>
    <span>🔒 Closed ${fmtFull(ticket.closed_at ?? ticket.created_at)}</span>
    ${agentTag ? `<span>🛡️ ${esc(agentTag)}</span>` : ''}
    <span>💬 ${messages.length} messages</span>
    <span>🏠 ${esc(guildName)}</span>
  </div>
</div>
<div class="msgs">${body}</div>
<div class="foot">Generated by ZendeskBotForOO &bull; ${new Date().toUTCString()}</div>
</body>
</html>`;
}
