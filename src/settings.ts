/*
 * TableSearch — format pane
 *
 * Every property here has a matching entry under `objects` in `capabilities.json`; the `name`
 * fields must stay identical on both sides or the pane silently drops the slice.
 */

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
    colors = new ColorsCard();

    cards = [this.table, this.search, this.colors];
}
