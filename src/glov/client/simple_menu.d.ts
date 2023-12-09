import { MenuItem, SelectionBoxOpts } from './selection_box';

export interface SimpleMenu {
  run(params?: SelectionBoxOpts): number;
  isSelected(): boolean | string;
  isSelected(tag_or_index?: number | string): boolean;

  getSelectedIndex(): number;
  getSelectedItem(): MenuItem;
  getItem(index: number): MenuItem;
}

export function simpleMenuCreate(params?: SelectionBoxOpts): SimpleMenu;
