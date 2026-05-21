<template>
  <Teleport to="body">
    <div
      v-if="isDragging && dragItem"
      class="fb-drag-ghost"
      :style="{ left: ghostX + 'px', top: ghostY + 'px' }"
    >{{ dragItem.name }}</div>
  </Teleport>

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
            'is-drop-target': item.isDirectory && dropTarget === item.path,
            'is-dragging': isDragging && dragItem?.path === item.path,
          }"
          :style="{ paddingLeft: `${0.5 + item.depth * 1}rem` }"
          :data-fb-path="item.path"
          :data-fb-dir="item.isDirectory ? '1' : undefined"
          @pointerdown="onPointerDown($event, item)"
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
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { readDir, rename, type DirEntry } from '@tauri-apps/plugin-fs';
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

const dragItem = ref<TreeItem | null>(null);
const dropTarget = ref<string | null>(null);
const isDragging = ref(false);
const ghostX = ref(0);
const ghostY = ref(0);
let mouseDownPos: { x: number; y: number } | null = null;
let wasDragging = false;
const DRAG_THRESHOLD = 5;

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
  if (wasDragging) { wasDragging = false; return; }
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

function parentDir(filePath: string): string {
  const sep = filePath.includes('\\') ? '\\' : '/';
  const parts = filePath.split(sep);
  parts.pop();
  return parts.join(sep);
}

function onPointerDown(event: PointerEvent, item: TreeItem) {
  if (item.isDirectory || event.button !== 0) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  dragItem.value = item;
  mouseDownPos = { x: event.clientX, y: event.clientY };
}

function resolveDropTarget(el: HTMLElement | null): string | null {
  if (!dragItem.value) return null;
  const li = el?.closest('[data-fb-path]') as HTMLElement | null;
  const liPath = li?.dataset.fbPath;
  if (!liPath) return null;
  const targetDir = li!.dataset.fbDir ? liPath : parentDir(liPath);
  if (targetDir === parentDir(dragItem.value.path)) return null;
  if (targetDir === dragItem.value.path) return null;
  return targetDir;
}

function onDocPointerMove(event: PointerEvent) {
  if (!dragItem.value || !mouseDownPos) return;

  const dx = event.clientX - mouseDownPos.x;
  const dy = event.clientY - mouseDownPos.y;

  if (!isDragging.value) {
    if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
    isDragging.value = true;
    document.body.style.userSelect = 'none';
  }

  ghostX.value = event.clientX;
  ghostY.value = event.clientY;

  const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
  dropTarget.value = resolveDropTarget(el);
}

function onDocPointerUp(event: PointerEvent) {
  if (!dragItem.value) return;

  if (isDragging.value) {
    const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const finalTarget = resolveDropTarget(el) ?? dropTarget.value;
    if (finalTarget) performMove(dragItem.value, finalTarget);
  }

  wasDragging = isDragging.value;
  dragItem.value = null;
  dropTarget.value = null;
  isDragging.value = false;
  mouseDownPos = null;
  document.body.style.userSelect = '';
}

async function performMove(src: TreeItem, destDirPath: string) {
  const sep = destDirPath.includes('\\') ? '\\' : '/';
  const destFilePath = destDirPath + sep + src.name;
  try {
    await rename(src.path, destFilePath);
    if (editorStore.filePath === src.path) editorStore.filePath = destFilePath;
    await refreshAffectedDirs(src.path, destDirPath);
  } catch (e) {
    console.error('Move failed:', e);
  }
}

async function refreshAffectedDirs(srcPath: string, destDirPath: string) {
  const srcDir = parentDir(srcPath);

  const idx = treeItems.value.findIndex(i => i.path === srcPath);
  if (idx !== -1) treeItems.value.splice(idx, 1);

  const refreshDir = async (dirPath: string) => {
    const dirItem = treeItems.value.find(i => i.path === dirPath && i.isDirectory);
    if (!dirItem?.expanded) return;
    const dirIdx = treeItems.value.findIndex(i => i.path === dirPath);
    if (dirIdx === -1) return;
    const entries = await readDir(dirPath);
    const children = await toItems(entries, dirPath, dirItem.depth + 1);
    let count = 0;
    for (let i = dirIdx + 1; i < treeItems.value.length; i++) {
      if (treeItems.value[i].depth > dirItem.depth) count++;
      else break;
    }
    treeItems.value.splice(dirIdx + 1, count, ...children);
  };

  if (destDirPath === settingsStore.sidebarFolder) {
    await loadRoot(destDirPath);
  } else {
    await refreshDir(destDirPath);
    if (srcDir !== destDirPath) await refreshDir(srcDir);
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
  document.addEventListener('pointermove', onDocPointerMove);
  document.addEventListener('pointerup', onDocPointerUp);
  if (settingsStore.sidebarFolder) {
    await loadRoot(settingsStore.sidebarFolder);
  }
});

onUnmounted(() => {
  document.removeEventListener('pointermove', onDocPointerMove);
  document.removeEventListener('pointerup', onDocPointerUp);
  document.body.style.userSelect = '';
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

.fb-item.is-drop-target {
  background: var(--accent-subtle);
  outline: 1px solid var(--accent-color);
  outline-offset: -1px;
}

.fb-item:not(.is-dir) { cursor: grab; }

.fb-item.is-dragging { opacity: 0.4; cursor: grabbing; }

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

<style>
.fb-drag-ghost {
  position: fixed;
  pointer-events: none;
  background: var(--bg-secondary, #fff);
  border: 1px solid var(--accent-color, #888);
  color: var(--text-color, #000);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.8125rem;
  z-index: 9999;
  white-space: nowrap;
  transform: translate(12px, -50%);
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}
</style>
