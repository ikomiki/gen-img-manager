import { invoke } from "@tauri-apps/api/core";
import type { Directory } from "../types";

export const listDirectories = () => invoke<Directory[]>("list_directories");

export const addDirectory = (path: string, recursive: boolean) =>
  invoke<Directory>("add_directory", { path, recursive });

export const removeDirectory = (id: number) =>
  invoke<void>("remove_directory", { id });
