export type TicketStatus = 'valid' | 'checked_in' | 'cancelled';
export type ScanResult = 'success' | 'already_used' | 'invalid' | 'wrong_event';
export type EmailStatus = 'pending' | 'sent' | 'preview' | 'retrying' | 'failed' | 'skipped';

export interface Stats {
  checkedIn: number;
  issued: number;
  capacity: number;
}

export interface EventSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  startsAt: string;
  venue: string;
  capacity: number;
  coverUrl: string | null;
  published: boolean;
  isDemo?: boolean;
  stats?: Stats | null;
  remaining?: number;
}

export interface Ticket {
  id: string;
  name: string;
  email: string;
  code: string;
  status: TicketStatus;
  issuedAt: string;
  checkedInAt: string | null;
  checkedInBy: string | null;
  qrReady: boolean;
  emailStatus: EmailStatus;
  emailAttempts: number;
  emailError: string | null;
}

export interface ScanOutcome {
  result: ScanResult;
  reason?: 'cancelled' | 'bad_signature' | 'not_found' | 'other_event';
  ticket?: { id: string; name: string; email: string; checkedInAt: string | null; checkedInBy: string | null };
  otherEventTitle?: string;
  replayed?: boolean;
  stats?: Stats | null;
}

export interface ScanLogEntry {
  id: number | string;
  at: string;
  result: ScanResult;
  reason?: string | null;
  device?: string | null;
  ticketId?: string | null;
  name?: string | null;
}

export type LiveMessage =
  | { type: 'hello' }
  | { type: 'scan'; result: ScanResult; reason?: string; ticket?: ScanOutcome['ticket']; device: string | null; at: string; stats: Stats }
  | { type: 'ticket'; ticketId: string; stats?: Stats };
