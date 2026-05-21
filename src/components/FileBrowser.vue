<template>
  <div class="file-browser">
    <div class="fb-header">
      <span class="fb-folder-label" :title="settingsStore.sidebarFolder || ''">
        {{ folderName }}
      </span>
      <button class="fb-btn" @click="openFolder" title="Open folder…">
        <span class="fb-icon" :style="{ '--icon': `url(${iconOpen})` }"></span>
      </button>
    </div>

    <div v-if="!settingsStore.sidebarFolder" class="fb-placeholder">
      <button class="fb-open-btn" @click="openFolder">Open Folder…</button>
    </div>
    <div v-else-if="loading" class="fb-placeholder">
      <span class="fb-spinner"></span>
    </div>
    <div v-else-if="treeItems.length === 0" class="fb-placeholder">No markdown files</div>
    <div v-else class="fb-scroll">
      <ul class="fb-tree">
        <li
          v-for="(item, index) in treeItems"
          :key="item.path"
          class="fb-item"
          :class="{
            'is-dir': item.isDirectory,
            'is-active': !item.isDirectory && item.path === editorStore.filePath,
          }"
          :style="{ paddingLeft: `${0.5 + item.depth * 1}rem` }"
          @click="handleItemClick(item, index)"
        >
          <span v-if="item.isDirectory && loadingPath === item.path" class="fb-spinner fb-spinner--inline"></span>
          <span v-else-if="item.isDirectory" class="fb-arrow">{{ item.expanded ? '▾' : '▸' }}</span>
          <span v-else class="fb-dot"></span>
          <span class="fb-name">{{ item.name }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { readDir, type DirEntry } from '@tauri-apps/plugin-fs';
import { open } from '@tauri-apps/plugin-dialog';
import { useSettingsStore } from '../stores/settings';
import { useEditorStore } from '../stores/editor';
import { loadFileFromPath } from '../services/fileService';
import iconOpen from '../assets/icons/icons8-open-file-100.png';

const settingsStore = useSettingsStore();
const editorStore = useEditorStore();

interface TreeItem {
  path: string;
  name: string;
  isDirectory: boolean;
  depth: number;
  expanded: boolean;
}

const treeItems = ref<TreeItem[]>([]);
const loading = ref(false);
const loadingPath = ref<string | null>(null);

const folderName = computed(() => {
  if (!settingsStore.sidebarFolder) return 'No folder';
  const parts = settingsStore.sidebarFolder.split(/[\\/]/);
  return parts[parts.length - 1] || settingsStore.sidebarFolder;
});

function joinPath(parent: string, name: string): string {
  const sep = parent.includes('\\') ? '\\' : '/';
  return parent.endsWith(sep) ? parent + name : parent + sep + name;
}

async function hasMarkdownDescendant(dirPath: string): Promise<boolean> {
  try {
    const entries = await readDir(dirPath);
    for (const e of entries) {
      if (e.isFile && /\.(md|markdown)$/i.test(e.name)) return true;
      if (e.isDirectory && await hasMarkdownDescendant(joinPath(dirPath, e.name))) return true;
    }
  } catch { /* unreadable — skip */ }
  return false;
}

async function toItems(entries: DirEntry[], parentPath: string, depth: number): Promise<TreeItem[]> {
  const dirEntries = entries.filter(e => e.isDirectory);
  const fileEntries = entries
    .filter(e => e.isFile && /\.(md|markdown)$/i.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const dirChecks = await Promise.all(
    dirEntries.map(async e => ({
      entry: e,
      keep: await hasMarkdownDescendant(joinPath(parentPath, e.name)),
    }))
  );
  const validDirs = dirChecks
    .filter(d => d.keep)
    .map(d => d.entry)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  return [...validDirs, ...fileEntries].map(e => ({
    path: joinPath(parentPath, e.name),
    name: e.name,
    isDirectory: e.isDirectory,
    depth,
    expanded: false,
  }));
}

async function loadRoot(folderPath: string) {
  loading.value = true;
  treeItems.value = [];
  try {
    const entries = await readDir(folderPath);
    treeItems.value = await toItems(entries, folderPath, 0);
  } catch {
    // Non-critical — folder may have been deleted or permissions changed
  } finally {
    loading.value = false;
  }
}

async function handleItemClick(item: TreeItem, index: number) {
  if (item.isDirectory) {
    if (item.expanded) {
      let count = 0;
      for (let i = index + 1; i < treeItems.value.length; i++) {
        if (treeItems.value[i].depth > item.depth) count++;
        else break;
      }
      treeItems.value.splice(index + 1, count);
      item.expanded = false;
    } else {
      loadingPath.value = item.path;
      try {
        const entries = await readDir(item.path);
        const children = await toItems(entries, item.path, item.depth + 1);
        treeItems.value.splice(index + 1, 0, ...children);
        item.expanded = true;
      } catch {
        // Non-critical — skip unreadable directories
      } finally {
        loadingPath.value = null;
      }
    }
  } else {
    await loadFileFromPath(editorStore, item.path);
  }
}

async function openFolder() {
  const selected = await open({ directory: true, multiple: false });
  if (!selected || typeof selected !== 'string') return;
  settingsStore.setSidebarFolder(selected);
  settingsStore.persist();
  await loadRoot(selected);
}

onMounted(async () => {
  if (settingsStore.sidebarFolder) {
    await loadRoot(settingsStore.sidebarFolder);
  }
});
</script>

<style scoped>
.file-browser {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  overflow: hidden;
  transition: background 0.25s, border-color 0.25s;
}

.fb-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.fb-folder-label {
  flex: 1;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fb-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-muted);
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.fb-btn:hover {
  background: var(--btn-hover);
  color: var(--accent-color);
}

.fb-icon {
  width: 13px;
  height: 13px;
  background-color: currentColor;
  -webkit-mask: var(--icon) center / contain no-repeat;
  mask: var(--icon) center / contain no-repeat;
}

.fb-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1.5rem 1rem;
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.fb-open-btn {
  background: var(--accent-subtle);
  color: var(--accent-color);
  border: none;
  padding: 0.35rem 0.75rem;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.fb-open-btn:hover {
  background: var(--accent-color);
  color: var(--bg-color);
}

.fb-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.fb-scroll::-webkit-scrollbar { width: 4px; }
.fb-scroll::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 2px;
}
.fb-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}

.fb-tree {
  list-style: none;
  padding: 0.25rem 0;
  margin: 0;
}

.fb-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding-top: 0.2rem;
  padding-bottom: 0.2rem;
  padding-right: 0.5rem;
  cursor: pointer;
  font-size: 0.8125rem;
  color: var(--text-color);
  white-space: nowrap;
  overflow: hidden;
  user-select: none;
  transition: background 0.1s;
}

.fb-item:hover { background: var(--btn-hover); }

.fb-item.is-active {
  background: var(--accent-subtle);
  color: var(--accent-color);
  font-weight: 500;
}

.fb-item.is-dir { font-weight: 500; }

@keyframes fb-spin {
  to { transform: rotate(360deg); }
}

.fb-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-color);
  border-top-color: var(--accent-color);
  border-radius: 50%;
  animation: fb-spin 0.7s linear infinite;
  flex-shrink: 0;
}

.fb-spinner--inline {
  width: 12px;
  height: 12px;
  border-width: 1.5px;
}

.fb-arrow {
  font-size: 0.6875rem;
  width: 12px;
  flex-shrink: 0;
  color: var(--text-muted);
  line-height: 1;
}

.fb-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
  margin: 0 4px;
}

.fb-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
