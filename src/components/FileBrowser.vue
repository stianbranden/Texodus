<template>
  <Teleport to="body">
    <div
      v-if="isDragging && dragItem"
      class="fb-drag-ghost"
      :style="{ left: ghostX + 'px', top: ghostY + 'px' }"
    >{{ dragItem.name }}</div>
  </Teleport>

  <div class="file-browser" :style="{ width: settingsStore.sidebarWidth + 'px' }">
    <div class="fb-resize-handle" @pointerdown.stop="onResizePointerDown"></div>

    <div class="fb-content">
      <!-- ── LOCAL SECTION ────────────────────────────────── -->
      <div class="fb-section-header">
        <button class="fb-btn" @click="localCollapsed = !localCollapsed" :title="localCollapsed ? 'Expand' : 'Collapse'">{{ localCollapsed ? '▸' : '▾' }}</button>
        <span class="fb-section-label" :title="settingsStore.sidebarFolder || ''">
          {{ localFolderName }}
        </span>
        <button class="fb-btn" @click="openFolder" title="Open folder…">
          <span class="fb-icon" :style="{ '--icon': `url(${iconOpen})` }"></span>
        </button>
        <button class="fb-btn" @click="collapseSidebar" title="Collapse sidebar">‹</button>
      </div>

      <template v-if="!localCollapsed">
        <div v-if="!settingsStore.sidebarFolder" class="fb-inline-empty">
          <button class="fb-open-btn" @click="openFolder">Open Folder…</button>
        </div>
        <div v-else-if="loading" class="fb-inline-empty">
          <span class="fb-spinner"></span>
        </div>
        <div v-else-if="treeItems.length === 0" class="fb-inline-empty fb-inline-empty--text">
          No markdown files
        </div>
        <ul v-else class="fb-tree">
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
      </template>

      <!-- ── R2 ACCOUNT SECTIONS ─────────────────────────── -->
      <template v-for="account in settingsStore.r2Accounts" :key="account.id">
        <div class="fb-divider"></div>

        <div class="fb-section-header">
          <button class="fb-btn" @click="toggleAccount(account.id)" :title="collapsedAccounts.has(account.id) ? 'Expand' : 'Collapse'">{{ collapsedAccounts.has(account.id) ? '▸' : '▾' }}</button>
          <span class="fb-section-label">R2: {{ account.label }}</span>
          <button
            class="fb-btn"
            title="Add bucket to this account"
            @click="openAddBucketDialog(account.id)"
          >+</button>
          <button
            class="fb-btn fb-btn--danger"
            title="Remove account and all its buckets"
            @click="removeR2Account(account.id)"
          >✕</button>
        </div>

        <template v-if="!collapsedAccounts.has(account.id)">
        <div v-if="bucketsForAccount(account.id).length === 0" class="fb-inline-empty fb-inline-empty--text">
          No buckets — click + to add one
        </div>

        <template v-for="bucket in bucketsForAccount(account.id)" :key="bucket.id">
          <div class="fb-bucket-header">
            <span class="fb-bucket-label">{{ bucket.bucketName }}</span>
            <span v-if="bucket.jurisdiction" class="fb-bucket-tag">{{ bucket.jurisdiction.toUpperCase() }}</span>
            <button
              class="fb-btn fb-btn--danger"
              title="Remove bucket"
              @click="removeR2Bucket(bucket.id)"
            >✕</button>
          </div>

          <div v-if="r2BucketLoading[bucket.id]" class="fb-inline-empty">
            <span class="fb-spinner"></span>
          </div>
          <div v-else-if="!r2Trees[bucket.id]?.length" class="fb-inline-empty fb-inline-empty--text">
            Empty bucket
          </div>
          <ul v-else class="fb-tree">
            <li
              v-for="(item, index) in r2Trees[bucket.id]"
              :key="item.key"
              class="fb-item"
              :class="{
                'is-dir': item.isDirectory,
                'is-active': !item.isDirectory && editorStore.filePath === `r2://${bucket.id}/${item.key}`,
              }"
              :style="{ paddingLeft: `${0.5 + item.depth * 1}rem` }"
              @click="handleR2ItemClick(bucket.id, item, index)"
            >
              <span v-if="item.isDirectory && r2DirLoadingPath[bucket.id] === item.key" class="fb-spinner fb-spinner--inline"></span>
              <span v-else-if="item.isDirectory" class="fb-arrow">{{ item.expanded ? '▾' : '▸' }}</span>
              <span v-else class="fb-dot"></span>
              <span class="fb-name">{{ item.name }}</span>
            </li>
          </ul>
        </template>
        </template>
      </template>

      <!-- ── FOOTER ──────────────────────────────────────── -->
      <div class="fb-footer">
        <button class="fb-connect-btn" @click="r2AddAccountDialogVisible = true">+ Add R2 Account</button>
      </div>
    </div>
  </div>

  <R2AccountDialog
    v-if="r2AddAccountDialogVisible"
    @close="r2AddAccountDialogVisible = false"
    @saved="onR2AccountSaved"
  />
  <R2BucketDialog
    v-if="r2AddBucketDialogVisible"
    :default-account-id="r2AddBucketForAccountId"
    @close="r2AddBucketDialogVisible = false"
    @saved="onR2BucketSaved"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { readDir, rename, type DirEntry } from '@tauri-apps/plugin-fs';
import { open } from '@tauri-apps/plugin-dialog';
import { useSettingsStore } from '../stores/settings';
import type { R2BucketConfig } from '../stores/settings';
import type { R2AccountConfig } from '../stores/settings';
import { useEditorStore } from '../stores/editor';
import { loadFileFromPath, loadR2File } from '../services/fileService';
import { listObjects } from '../services/r2Service';
import R2AccountDialog from './R2AccountDialog.vue';
import R2BucketDialog from './R2BucketDialog.vue';
import iconOpen from '../assets/icons/icons8-open-file-100.png';

const settingsStore = useSettingsStore();
const editorStore = useEditorStore();

const localCollapsed = ref(false);
const collapsedAccounts = ref<Set<string>>(new Set());

function collapseSidebar() {
  settingsStore.setSidebarVisible(false);
  settingsStore.persist();
}

function toggleAccount(id: string) {
  const s = new Set(collapsedAccounts.value);
  s.has(id) ? s.delete(id) : s.add(id);
  collapsedAccounts.value = s;
}

// ── Local file tree ────────────────────────────────────────────────────────────

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

const isResizing = ref(false);
let resizeStartX = 0;
let resizeStartWidth = 0;

const localFolderName = computed(() => {
  if (!settingsStore.sidebarFolder) return 'Local Folder';
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

function onResizePointerDown(event: PointerEvent) {
  isResizing.value = true;
  resizeStartX = event.clientX;
  resizeStartWidth = settingsStore.sidebarWidth;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function onDocPointerMove(event: PointerEvent) {
  if (isResizing.value) {
    settingsStore.setSidebarWidth(resizeStartWidth + (event.clientX - resizeStartX));
    return;
  }
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
  if (isResizing.value) {
    isResizing.value = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    settingsStore.persist();
    return;
  }
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

// ── R2 tree ────────────────────────────────────────────────────────────────────

interface R2TreeItem {
  key: string;
  name: string;
  isDirectory: boolean;
  depth: number;
  expanded: boolean;
}

const r2Trees = ref<Record<string, R2TreeItem[]>>({});
const r2BucketLoading = ref<Record<string, boolean>>({});
const r2DirLoadingPath = ref<Record<string, string | null>>({});
const r2AddAccountDialogVisible = ref(false);
const r2AddBucketDialogVisible = ref(false);
const r2AddBucketForAccountId = ref('');

function bucketsForAccount(accountId: string) {
  return settingsStore.r2Buckets.filter(b => b.accountConfigId === accountId);
}

function r2ItemName(keyOrPrefix: string): string {
  const trimmed = keyOrPrefix.endsWith('/') ? keyOrPrefix.slice(0, -1) : keyOrPrefix;
  const parts = trimmed.split('/');
  return parts[parts.length - 1] || keyOrPrefix;
}

function r2ToItems(prefixes: string[], keys: string[], depth: number): R2TreeItem[] {
  const dirs = prefixes.map(p => ({
    key: p,
    name: r2ItemName(p),
    isDirectory: true,
    depth,
    expanded: false,
  }));
  const files = keys
    .filter(k => /\.(md|markdown)$/i.test(k))
    .sort((a, b) => a.localeCompare(b))
    .map(k => ({
      key: k,
      name: r2ItemName(k),
      isDirectory: false,
      depth,
      expanded: false,
    }));
  return [...dirs, ...files];
}

async function loadR2Root(bucket: R2BucketConfig) {
  const account = settingsStore.r2Accounts.find(a => a.id === bucket.accountConfigId);
  if (!account) return;
  r2BucketLoading.value[bucket.id] = true;
  r2Trees.value[bucket.id] = [];
  try {
    const result = await listObjects(account, bucket, '', '/');
    r2Trees.value[bucket.id] = r2ToItems(result.prefixes, result.keys, 0);
  } catch (e) {
    console.error('R2 load failed:', e);
  } finally {
    r2BucketLoading.value[bucket.id] = false;
  }
}

async function handleR2ItemClick(bucketId: string, item: R2TreeItem, index: number) {
  const bucket = settingsStore.r2Buckets.find(b => b.id === bucketId);
  if (!bucket) return;
  const account = settingsStore.r2Accounts.find(a => a.id === bucket.accountConfigId);
  if (!account) return;
  const items = r2Trees.value[bucketId];
  if (!items) return;

  if (item.isDirectory) {
    if (item.expanded) {
      let count = 0;
      for (let i = index + 1; i < items.length; i++) {
        if (items[i].depth > item.depth) count++;
        else break;
      }
      items.splice(index + 1, count);
      item.expanded = false;
    } else {
      r2DirLoadingPath.value[bucketId] = item.key;
      try {
        const result = await listObjects(account, bucket, item.key, '/');
        const children = r2ToItems(result.prefixes, result.keys, item.depth + 1);
        items.splice(index + 1, 0, ...children);
        item.expanded = true;
      } catch (e) {
        console.error('R2 expand failed:', e);
      } finally {
        r2DirLoadingPath.value[bucketId] = null;
      }
    }
  } else {
    await loadR2File(editorStore, bucketId, item.key);
  }
}

function openAddBucketDialog(accountId: string) {
  r2AddBucketForAccountId.value = accountId;
  r2AddBucketDialogVisible.value = true;
}

async function onR2AccountSaved(config: R2AccountConfig) {
  r2AddAccountDialogVisible.value = false;
  settingsStore.addR2Account(config);
  settingsStore.persist();
}

async function onR2BucketSaved(config: R2BucketConfig) {
  r2AddBucketDialogVisible.value = false;
  r2AddBucketForAccountId.value = '';
  settingsStore.addR2Bucket(config);
  settingsStore.persist();
  await loadR2Root(config);
}

function removeR2Account(accountId: string) {
  const buckets = bucketsForAccount(accountId);
  for (const b of buckets) {
    delete r2Trees.value[b.id];
    delete r2BucketLoading.value[b.id];
    delete r2DirLoadingPath.value[b.id];
  }
  settingsStore.removeR2Account(accountId);
  settingsStore.persist();
}

function removeR2Bucket(id: string) {
  settingsStore.removeR2Bucket(id);
  settingsStore.persist();
  delete r2Trees.value[id];
  delete r2BucketLoading.value[id];
  delete r2DirLoadingPath.value[id];
}

onMounted(async () => {
  document.addEventListener('pointermove', onDocPointerMove);
  document.addEventListener('pointerup', onDocPointerUp);
  if (settingsStore.sidebarFolder) {
    await loadRoot(settingsStore.sidebarFolder);
  }
  for (const bucket of settingsStore.r2Buckets) {
    await loadR2Root(bucket);
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
  flex-shrink: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  overflow: hidden;
  transition: background 0.25s, border-color 0.25s;
}

.fb-resize-handle {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
}

.fb-resize-handle:hover {
  background: var(--accent-color);
  opacity: 0.4;
}

.fb-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
}

.fb-content::-webkit-scrollbar { width: 4px; }
.fb-content::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 2px;
}
.fb-content::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}

.fb-section-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
  position: sticky;
  top: 0;
  background: var(--bg-secondary);
  z-index: 1;
}

.fb-section-label {
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

.fb-bucket-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0.3rem 0.5rem 0.3rem 1rem;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
  background: var(--bg-secondary);
}

.fb-bucket-label {
  flex: 1;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fb-bucket-tag {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--accent-color);
  background: var(--accent-subtle);
  border-radius: 3px;
  padding: 1px 4px;
  flex-shrink: 0;
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
  font-size: 0.75rem;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}

.fb-btn:hover {
  background: var(--btn-hover);
  color: var(--accent-color);
}

.fb-btn--danger:hover {
  color: color-mix(in srgb, red 70%, var(--text-color));
}

.fb-icon {
  width: 13px;
  height: 13px;
  background-color: currentColor;
  -webkit-mask: var(--icon) center / contain no-repeat;
  mask: var(--icon) center / contain no-repeat;
}

.fb-inline-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.fb-inline-empty--text {
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

.fb-divider {
  height: 1px;
  background: var(--border-color);
  flex-shrink: 0;
  margin-top: 0.25rem;
}

.fb-footer {
  padding: 0.6rem 0.5rem;
  margin-top: auto;
  border-top: 1px solid var(--border-color);
}

.fb-connect-btn {
  width: 100%;
  background: transparent;
  border: 1px dashed var(--border-color);
  border-radius: 6px;
  padding: 0.3rem 0.5rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  cursor: pointer;
  text-align: center;
  transition: border-color 0.15s, color 0.15s;
  font-family: inherit;
}

.fb-connect-btn:hover {
  border-color: var(--accent-color);
  color: var(--accent-color);
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
