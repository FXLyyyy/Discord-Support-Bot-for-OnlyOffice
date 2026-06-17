import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
} from 'docx';
import { Ticket, TicketMessage, TicketNote } from '../types';

// Brand palette (hex without leading '#', as docx expects).
const C = {
  ink: '1E1F22',
  muted: '6D6F78',
  accent: '5865F2',
  green: '2E7D46',
  amber: '8A5A00',
  line: 'E3E5E8',
  labelBg: 'F2F3F5',
};

const FONT = 'Arial';
const CONTENT_WIDTH = 9026; // A4 (11906) minus 1" margins each side, in DXA

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Multi-line text → one paragraph with soft line breaks (TextRun has no '\n').
function multiline(text: string, opts: { size?: number; color?: string } = {}): Paragraph {
  const { size = 20, color = C.ink } = opts;
  const lines = (text || '').split('\n');
  const runs = lines.map((line, i) =>
    i === 0
      ? new TextRun({ text: line, size, color, font: FONT })
      : new TextRun({ text: line, size, color, font: FONT, break: 1 }),
  );
  return new Paragraph({ spacing: { after: 80 }, children: runs });
}

// Section divider: small bold uppercase label with a hairline underline.
function heading(text: string, color: string): Paragraph {
  return new Paragraph({
    spacing: { before: 300, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.line, space: 4 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 19, color, font: FONT })],
  });
}

const cellBorders = {
  top: { style: BorderStyle.SINGLE, size: 2, color: C.line },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: C.line },
  left: { style: BorderStyle.SINGLE, size: 2, color: C.line },
  right: { style: BorderStyle.SINGLE, size: 2, color: C.line },
};

function metaRow(label: string, value: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 2400, type: WidthType.DXA },
        shading: { fill: C.labelBg, type: ShadingType.CLEAR, color: 'auto' },
        margins: { top: 60, bottom: 60, left: 120, right: 120 },
        borders: cellBorders,
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18, color: C.muted, font: FONT })] })],
      }),
      new TableCell({
        width: { size: 6626, type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 120, right: 120 },
        borders: cellBorders,
        children: [new Paragraph({ children: [new TextRun({ text: value, size: 18, color: C.ink, font: FONT })] })],
      }),
    ],
  });
}

export async function generateTranscriptDocx(params: {
  ticket: Ticket;
  messages: TicketMessage[];
  notes?: TicketNote[];
  openedByTag: string;
  agentTag: string | null;
  guildName: string;
  includeInternal?: boolean;
}): Promise<Buffer> {
  const { ticket, messages, openedByTag, agentTag, guildName } = params;
  const includeInternal = params.includeInternal !== false;
  const notes = includeInternal ? (params.notes ?? []) : [];

  const children: (Paragraph | Table)[] = [];

  // ── Title
  children.push(new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text: `Ticket #${ticket.ticket_number}`, bold: true, size: 40, color: C.accent, font: FONT })],
  }));
  children.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: ticket.subject || '(no subject)', bold: true, size: 26, color: C.ink, font: FONT })],
  }));

  // ── Metadata table (only rows that exist)
  const rows: TableRow[] = [metaRow('Status', ticket.status), metaRow('Opened by', openedByTag)];
  if (agentTag) rows.push(metaRow('Agent', agentTag));
  rows.push(metaRow('Opened', fmt(ticket.created_at)));
  if (ticket.closed_at) rows.push(metaRow('Closed', fmt(ticket.closed_at)));
  if (ticket.rating) rows.push(metaRow('Rating', `${ticket.rating} / 5`));
  rows.push(metaRow('Server', guildName));
  children.push(new Table({ width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: [2400, 6626], rows }));

  // ── Original request
  children.push(heading('Ticket submitted', C.accent));
  children.push(multiline(ticket.description || '(no description)'));

  // ── Resolution (shared with the user)
  if (ticket.resolution) {
    children.push(heading('Resolution', C.green));
    children.push(multiline(ticket.resolution));
  }

  // ── Internal close reason (staff copy only)
  if (includeInternal && ticket.close_reason) {
    children.push(heading('Close reason (internal)', C.amber));
    children.push(multiline(ticket.close_reason));
  }

  // ── Internal notes (staff copy only)
  if (notes.length > 0) {
    children.push(heading(`Internal notes (${notes.length})`, C.amber));
    for (const n of notes) {
      children.push(new Paragraph({
        spacing: { before: 80 },
        children: [
          new TextRun({ text: n.author_tag, bold: true, size: 18, color: C.ink, font: FONT }),
          new TextRun({ text: `   ${fmt(n.created_at)}`, size: 16, color: C.muted, font: FONT }),
        ],
      }));
      children.push(multiline(n.note));
    }
  }

  // ── Conversation
  children.push(heading(messages.length ? `Conversation (${messages.length})` : 'Conversation (no messages recorded)', C.muted));
  for (const m of messages) {
    children.push(new Paragraph({
      spacing: { before: 140, after: 20 },
      children: [
        new TextRun({ text: m.username, bold: true, size: 19, color: C.ink, font: FONT }),
        new TextRun({ text: `   ${fmt(m.created_at)}`, size: 15, color: C.muted, font: FONT }),
      ],
    }));
    if (m.content) children.push(multiline(m.content));
    for (const a of m.attachments) {
      children.push(new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: `📎 ${a.name}`, italics: true, size: 17, color: C.accent, font: FONT })],
      }));
    }
  }

  // ── Footer
  children.push(new Paragraph({
    spacing: { before: 360 },
    alignment: AlignmentType.CENTER,
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: C.line, space: 6 } },
    children: [new TextRun({ text: `Generated by OnlyOffice Support Bot • ${new Date().toUTCString()}`, size: 14, color: C.muted, font: FONT })],
  }));

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}
