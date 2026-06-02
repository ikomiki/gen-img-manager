export interface Directory {
  id: number;
  path: string;
  label: string;
  is_online: boolean;
  last_scanned_at: number | null;
  recursive: boolean;
}

export interface ScanProgress {
  directory_id: number;
  processed: number;
  total: number;
  current: string;
}

export interface ScanDone {
  directory_id: number;
  success: boolean;
}
