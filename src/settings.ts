/*
 * TableSearch — settings
 *
 * Plain defaults for now. `capabilities.json` declares `"objects": {}`, so there is nothing in
 * the format pane to read them from yet; once the Format Pane migration lands these become the
 * defaults behind `getFormattingModel`.
 */

import { ITableOptions } from './table';

export class TableSearchSettings {
    readonly table: Partial<ITableOptions> = {
        rowHeight: 24,
        minColumnWidth: 120,
        filterDebounceMs: 150,
        overscan: 10,
    };
}
