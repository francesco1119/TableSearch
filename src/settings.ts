/*
 * TableSearch — format pane
 *
 * Every property here has a matching entry under `objects` in `capabilities.json`; the `name`
 * fields must stay identical on both sides or the pane silently drops the slice.
 */

import powerbi from 'powerbi-visuals-api';
import { formattingSettings } from 'powerbi-visuals-utils-formattingmodel';

import Card = formattingSettings.SimpleCard;
import Model = formattingSettings.Model;

export const DEFAULTS = {
    rowHeight: 24,
    fontSize: 12,
    alternateRows: false,
    showSearch: true,
    headerBackground: '#FAF9F8',
    textColor: '#252423',
    gridColor: '#E1E1E1',
    selectionColor: '#DEECF9',
};

class TableCard extends Card {
    name = 'table';
    displayName = 'Table';

    rowHeight = new formattingSettings.NumUpDown({
        name: 'rowHeight',
        displayName: 'Row height',
        value: DEFAULTS.rowHeight,
    });

    fontSize = new formattingSettings.NumUpDown({
        name: 'fontSize',
        displayName: 'Text size',
        value: DEFAULTS.fontSize,
    });

    alternateRows = new formattingSettings.ToggleSwitch({
        name: 'alternateRows',
        displayName: 'Alternate row shading',
        value: DEFAULTS.alternateRows,
    });

    slices = [this.rowHeight, this.fontSize, this.alternateRows];
}

class SearchCard extends Card {
    name = 'search';
    displayName = 'Column search';

    /** Rendered as the card's own on/off switch rather than as a slice inside it. */
    show = new formattingSettings.ToggleSwitch({
        name: 'show',
        displayName: 'Show search boxes',
        value: DEFAULTS.showSearch,
    });

    topLevelSlice = this.show;
    slices: formattingSettings.Slice[] = [];
}

/** One column of the field well, as the Cell elements card needs to see it. */
export interface IColumnTarget {
    displayName: string;
    /** Identifies the column to the host, and scopes the colour to it. */
    queryName: string;
    /** Whatever is already set on this column, so the pickers open on the current value. */
    background?: string;
    fontColor?: string;
}

/**
 * Conditional formatting, the same shape as the native table's *Cell elements*.
 *
 * Two things make it work, and neither is optional:
 *
 * - `selector: { metadata: queryName }` scopes the property to one column, so each column
 *   keeps its own colour instead of all of them sharing one value.
 * - `instanceKind: ConstantOrRule` is what puts the *fx* button on the slice. Without it the
 *   user gets a plain colour picker and no rules, gradient or field value at all.
 *
 * The card is rebuilt on every update because the field well can change under us, and it is a
 * `Container` rather than two slices per column so the pane shows one column dropdown however
 * wide the table gets.
 */
class CellElementsCard extends Card {
    name = 'cellElements';
    displayName = 'Cell elements';

    slices: formattingSettings.Slice[] = [];

    public setColumns(columns: IColumnTarget[]): void {
        const items = columns.map((column) => {
            const selector = { metadata: column.queryName };
            const item = new formattingSettings.ContainerItem();
            item.displayName = column.displayName;
            item.slices = [
                new formattingSettings.ColorPicker({
                    name: 'backgroundColor',
                    displayName: 'Background color',
                    value: { value: column.background || '' },
                    selector,
                    instanceKind: powerbi.VisualEnumerationInstanceKinds.ConstantOrRule,
                    isNoFillItemSupported: true,
                }),
                new formattingSettings.ColorPicker({
                    name: 'fontColor',
                    displayName: 'Font color',
                    value: { value: column.fontColor || '' },
                    selector,
                    instanceKind: powerbi.VisualEnumerationInstanceKinds.ConstantOrRule,
                    isNoFillItemSupported: true,
                }),
            ];
            return item;
        });

        this.container = new formattingSettings.Container({
            displayName: 'Apply to column',
            containerItems: items,
        });
    }
}

class ColorsCard extends Card {
    name = 'colors';
    displayName = 'Colors';

    headerBackground = new formattingSettings.ColorPicker({
        name: 'headerBackground',
        displayName: 'Header background',
        value: { value: DEFAULTS.headerBackground },
    });

    textColor = new formattingSettings.ColorPicker({
        name: 'textColor',
        displayName: 'Text',
        value: { value: DEFAULTS.textColor },
    });

    gridColor = new formattingSettings.ColorPicker({
        name: 'gridColor',
        displayName: 'Grid lines',
        value: { value: DEFAULTS.gridColor },
    });

    selectionColor = new formattingSettings.ColorPicker({
        name: 'selectionColor',
        displayName: 'Selected row',
        value: { value: DEFAULTS.selectionColor },
    });

    slices = [this.headerBackground, this.textColor, this.gridColor, this.selectionColor];
}

export class TableSearchSettings extends Model {
    table = new TableCard();
    search = new SearchCard();
    cellElements = new CellElementsCard();
    colors = new ColorsCard();

    cards = [this.table, this.search, this.cellElements, this.colors];
}
