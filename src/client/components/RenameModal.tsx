// SPDX-License-Identifier: BSD-2-Clause
// Copyright (c) 2026 Jon Gill

// Rename a task or project.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Group, Modal, TextInput } from '@mantine/core';

interface Props {
  opened: boolean;
  title: string;
  name: string;
  /** Resolves true when saved; the modal stays open on failure. */
  onSave: (name: string) => Promise<boolean>;
  onClose: () => void;
}

export function RenameModal({ opened, title, name, onSave, onClose }: Props) {
  return (
    <Modal opened={opened} onClose={onClose} title={title} size="md">
      {/* Keyed form so the field starts from the current name each time it opens. */}
      {opened && <RenameForm name={name} onSave={onSave} onClose={onClose} />}
    </Modal>
  );
}

function RenameForm({ name, onSave, onClose }: Omit<Props, 'opened' | 'title'>) {
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = value.trim();
    if (!next || next === name) return onClose();
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    if (ok) onClose();
  };
  return (
    <form onSubmit={submit}>
      <TextInput label="Name" data-autofocus value={value} maxLength={200}
        onFocus={(e) => e.currentTarget.select()} onChange={(e) => setValue(e.currentTarget.value)} />
      <Group justify="flex-end" mt="lg">
        <Button variant="default" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={saving} disabled={!value.trim()}>Save</Button>
      </Group>
    </form>
  );
}
