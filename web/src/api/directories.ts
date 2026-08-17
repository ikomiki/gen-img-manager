import { getJson } from "./client";

export interface DirectoryDto {
  id: number;
  label: string;
  is_online: boolean;
  visible: boolean;
  image_count: number;
}

export const listDirectories = () => getJson<DirectoryDto[]>("/api/directories");
