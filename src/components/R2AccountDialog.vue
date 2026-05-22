<template>
  <Teleport to="body">
    <div class="r2a-backdrop" @click.self="$emit('close')">
      <div class="r2a-dialog">
        <h3 class="r2a-title">Add R2 Account</h3>

        <div class="r2a-field">
          <label>Label</label>
          <input v-model="form.label" placeholder="My Cloudflare Account" autocomplete="off" spellcheck="false" />
        </div>
        <div class="r2a-field">
          <label>Account ID</label>
          <input v-model="form.accountId" placeholder="abc123def456…" autocomplete="off" spellcheck="false" />
        </div>
        <div class="r2a-field">
          <label>Access Key ID</label>
          <input v-model="form.accessKeyId" placeholder="access key ID" autocomplete="off" spellcheck="false" />
        </div>
        <div class="r2a-field">
          <label>Secret Access Key</label>
          <input v-model="form.secretAccessKey" type="password" placeholder="secret key" autocomplete="new-password" />
        </div>

        <p v-if="testStatus" :class="['r2a-status', testStatus.ok ? 'r2a-status--ok' : 'r2a-status--err']">
          {{ testStatus.message }}
        </p>

        <div class="r2a-actions">
          <button class="r2a-btn r2a-btn--test" :disabled="testing || !canTest" @click="testAccount">
            {{ testing ? 'Testing…' : 'Test' }}
          </button>
          <div class="r2a-actions-right">
            <button class="r2a-btn r2a-btn--cancel" @click="$emit('close')">Cancel</button>
            <button class="r2a-btn r2a-btn--save" :disabled="!canSave" @click="handleSave">Save</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { reactive, ref, computed } from 'vue';
import { listBuckets } from '../services/r2Service';
import type { R2AccountConfig } from '../stores/settings';

const emit = defineEmits<{
  close: [];
  saved: [config: R2AccountConfig];
}>();

const form = reactive({
  label: '',
  accountId: '',
  accessKeyId: '',
  secretAccessKey: '',
});

const testing = ref(false);
const testStatus = ref<{ ok: boolean; message: string } | null>(null);

const canTest = computed(
  () => !!(form.accountId && form.accessKeyId && form.secretAccessKey),
);

const canSave = computed(
  () => !!(form.accountId && form.accessKeyId && form.secretAccessKey),
);

async function testAccount() {
  testing.value = true;
  testStatus.value = null;
  try {
    const account: R2AccountConfig = {
      id: 'test',
      label: form.label || form.accountId,
      accountId: form.accountId.trim(),
      accessKeyId: form.accessKeyId.trim(),
      secretAccessKey: form.secretAccessKey,
    };
    const buckets = await listBuckets(account);
    testStatus.value = {
      ok: true,
      message: buckets.length
        ? `Connected — ${buckets.length} bucket${buckets.length !== 1 ? 's' : ''} found`
        : 'Connected — no buckets found',
    };
  } catch (e) {
    testStatus.value = { ok: false, message: e instanceof Error ? e.message : String(e) };
  } finally {
    testing.value = false;
  }
}

function handleSave() {
  if (!canSave.value) return;
  const config: R2AccountConfig = {
    id: crypto.randomUUID(),
    label: form.label.trim() || form.accountId.trim(),
    accountId: form.accountId.trim(),
    accessKeyId: form.accessKeyId.trim(),
    secretAccessKey: form.secretAccessKey,
  };
  emit('saved', config);
}
</script>

<style scoped>
.r2a-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.r2a-dialog {
  background: var(--dialog-bg);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 1.25rem 1.5rem 1rem;
  width: 360px;
  max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.r2a-title {
  margin: 0 0 1rem;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-color);
}

.r2a-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-bottom: 0.75rem;
}

.r2a-field label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.r2a-field input {
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
  font-size: 0.8125rem;
  color: var(--text-color);
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}

.r2a-field input:focus {
  border-color: var(--accent-color);
}

.r2a-status {
  font-size: 0.75rem;
  margin: 0.25rem 0 0.75rem;
  padding: 0.35rem 0.6rem;
  border-radius: 5px;
}

.r2a-status--ok {
  background: var(--accent-subtle);
  color: var(--accent-color);
}

.r2a-status--err {
  background: color-mix(in srgb, red 12%, var(--dialog-bg));
  color: color-mix(in srgb, red 70%, var(--text-color));
}

.r2a-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.r2a-actions-right {
  display: flex;
  gap: 0.5rem;
  margin-left: auto;
}

.r2a-btn {
  border: none;
  border-radius: 6px;
  padding: 0.35rem 0.75rem;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  font-family: inherit;
}

.r2a-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.r2a-btn--test {
  background: var(--bg-color);
  color: var(--text-muted);
  border: 1px solid var(--border-color);
}

.r2a-btn--test:not(:disabled):hover {
  color: var(--text-color);
}

.r2a-btn--cancel {
  background: transparent;
  color: var(--text-muted);
}

.r2a-btn--cancel:hover {
  color: var(--text-color);
}

.r2a-btn--save {
  background: var(--accent-color);
  color: #fff;
}

.r2a-btn--save:not(:disabled):hover {
  opacity: 0.88;
}
</style>
