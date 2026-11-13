// SPDX-License-Identifier: BSD-2-Clause
// Copyright (c) 2026 Jon Gill

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
