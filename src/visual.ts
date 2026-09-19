/*
 * TableSearch — a searchable, cross-filtering table for Power BI
 *
 * Copyright (c) Francesco Mantovani. Released under the MIT License.
 *
 * The Power BI plumbing only. Everything visible lives in `table.ts`.
 *
 * This file began as the archived lineupjs/lineup_powerbi wrapper (MIT, Copyright (c) Samuel
 * Gratzl), which wrapped LineUp.js. LineUp was dropped once it was clear the product is a
 * filter table rather than a ranking tool: nearly every requirement turned out to be the
 * suppression of one of its features, and its filter widget rebuilt the whole column header on
 * each keystroke. None of that code remains, but the shape of the dataView handling here is
 * owed to it.
 */

import powerbi from 'powerbi-visuals-api';

import { ISortState, ITableColumn, SearchTable } from './table';
import { TableSearchSettings } from './settings';
import '../style/style.less';

import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import DataView = powerbi.DataView;
import DataViewTable = powerbi.DataViewTable;
import PowerBISortDirection = powerbi.SortDirection;
import VisualUpdateType = powerbi.VisualUpdateType;

interface IExtracted {
    columns: ITableColumn[];
    rows: unknown[][];
    ids: ISelectionId[];
    sort: ISortState | null;
}

export class TableSearchVisual implements IVisual {
    private readonly host: IVisualHost;
    private readonly selectionManager: ISelectionManager;
    private readonly container: HTMLElement;
    private readonly table: SearchTable;
    private readonly settings = new TableSearchSettings();

    /** Row index -> selection id, rebuilt on every extract. */
    private ids: ISelectionId[] = [];

    /** Guards the table's selection callback while a report-driven selection is being applied. */
    private applyingSelection = false;

    /** Set while a `fetchMoreData` request is outstanding. */
    private waitingForMoreData = false;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.selectionManager = options.host.createSelectionManager();

        this.container = document.createElement('div');
        this.container.className = 'ts';
        options.element.appendChild(this.container);

        this.table = new SearchTable(
            this.container,
            { onSelectionChanged: (indices) => this.onTableSelection(indices) },
            this.settings.table
        );

        // Power BI can clear or change the selection from outside the visual — another visual's
        // selection, or the report's clear-filter button. Mirror that back into the table.
        this.selectionManager.registerOnSelectCallback(() => this.restoreSelection());
    }

    public update(options: VisualUpdateOptions): void {
        // A resize carries the same dataView; re-extracting it would rebuild every selection id
        // and re-sort for nothing.
        const resizeOnly =
            options.type === VisualUpdateType.Resize || options.type === VisualUpdateType.ResizeEnd;
        if (resizeOnly) {
            this.table.layout();
            return;
        }

        const dataView: DataView | undefined = options.dataViews && options.dataViews[0];
        const table = dataView && dataView.table;
        if (!table) {
            return;
        }

        this.waitingForMoreData = false;

        const { columns, rows, ids, sort } = this.extract(table);
        this.ids = ids;

        this.table.setData(columns, rows);
        this.table.setSort(sort);
        this.table.layout();
        this.restoreSelection();

        this.requestMoreDataIfAvailable(dataView);
    }

    public destroy(): void {
        this.table.destroy();
        this.ids = [];
    }

    private extract(table: DataViewTable): IExtracted {
        const rows = (table.rows || []) as unknown[][];

        const columns: ITableColumn[] = table.columns.map((d) => {
            let type: ITableColumn['type'] = 'string';
            // A row identifier is always shown as text, whatever Power BI calls it.
            if (d.type && !(d.roles && d.roles.row)) {
                if (d.type.bool) {
                    type = 'boolean';
                } else if (d.type.integer || d.type.numeric) {
                    type = 'number';
                } else if (d.type.dateTime) {
                    type = 'date';
                }
            }
            return { label: d.displayName, index: d.index!, type };
        });

        const ids = rows.map((_, rowIndex) =>
            this.host.createSelectionIdBuilder().withTable(table, rowIndex).createSelectionId()
        );

        // Power BI allows several sort columns; the table sorts by one, so the primary wins.
        const sorted = table.columns
            .filter((d) => d.sort)
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        const primary = sorted[0];
        const sort: ISortState | null = primary
            ? {
                  column: table.columns.indexOf(primary),
                  direction: primary.sort === PowerBISortDirection.Ascending ? 'asc' : 'desc',
              }
            : null;

        return { columns, rows, ids, sort };
    }

    /** Pushes the table's own selection out to the rest of the report. */
    private onTableSelection(indices: number[]): void {
        if (this.applyingSelection) {
            return;
        }
        const selected = indices.map((i) => this.ids[i]).filter((id) => !!id);
        if (selected.length > 0) {
            void this.selectionManager.select(selected);
        } else {
            void this.selectionManager.clear();
        }
    }

    /** Pushes the report's current selection into the table without echoing it back out. */
    private restoreSelection(): void {
        const current = (this.selectionManager.getSelectionIds() || []) as ISelectionId[];
        const keys = new Set(current.map((id) => id.getKey()));
        const indices: number[] = [];
        this.ids.forEach((id, i) => {
            if (id && keys.has(id.getKey())) {
                indices.push(i);
            }
        });

        this.applyingSelection = true;
        try {
            this.table.setSelection(indices);
        } finally {
            this.applyingSelection = false;
        }
    }

    /**
     * The table mapping uses a windowed data reduction, so the host hands over one window at a
     * time and appends the next only when asked. `metadata.segment` is present for as long as
     * the result is incomplete.
     */
    private requestMoreDataIfAvailable(dataView: DataView): void {
        const hasMore = !!(dataView.metadata && (dataView.metadata as any).segment);
        if (hasMore && !this.waitingForMoreData && this.host.fetchMoreData) {
            this.waitingForMoreData = true;
            this.host.fetchMoreData(true);
        }
    }
}
