import { describe, it, expect, vi, beforeEach } from "vitest";
import { useLibraryStore } from "./useLibraryStore";
import * as api from "../api/directories";

vi.mock("../api/directories");

const dir = (id: number, label: string): import("../types").Directory => ({
  id, path: `/p/${label}`, label, is_online: true, last_scanned_at: null, recursive: true,
});

beforeEach(() => {
  useLibraryStore.setState({ directories: [] });
  vi.resetAllMocks();
});

describe("useLibraryStore", () => {
  it("loadDirectories populates state", async () => {
    vi.mocked(api.listDirectories).mockResolvedValue([dir(1, "a")]);
    await useLibraryStore.getState().loadDirectories();
    expect(useLibraryStore.getState().directories).toHaveLength(1);
  });

  it("addDirectory appends the returned directory", async () => {
    vi.mocked(api.addDirectory).mockResolvedValue(dir(2, "b"));
    await useLibraryStore.getState().addDirectory("/p/b", true);
    expect(useLibraryStore.getState().directories[0].id).toBe(2);
  });

  it("removeDirectory drops by id", async () => {
    useLibraryStore.setState({ directories: [dir(1, "a")] });
    vi.mocked(api.removeDirectory).mockResolvedValue(undefined as unknown as void);
    await useLibraryStore.getState().removeDirectory(1);
    expect(useLibraryStore.getState().directories).toHaveLength(0);
  });
});
