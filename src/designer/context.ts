import { createContext, useContext } from 'react';
import type { DataRow, FieldDef, ReportDataSource } from '../core/types';
import type { ToolboxItem } from '../ui/config';
import type { DesignerStore } from './store';

export interface FlatField extends FieldDef {
  path: string;
}

export interface ExpressionRequest {
  title?: string;
  value: string;
  /** Called with the new expression when the user presses OK. */
  onApply: (value: string) => void;
  /** Expression must evaluate to a boolean (shown as hint). */
  boolean?: boolean;
}

export interface DesignerContextValue {
  store: DesignerStore;
  dataSources: ReportDataSource[];
  fields: FlatField[];
  sampleRows: DataRow[];
  toolbox: ToolboxItem[];
  zoom: number;
  grid: { size: number; show: boolean; snap: boolean };
  openExpression: (req: ExpressionRequest) => void;
  readOnly: boolean;
}

export const DesignerContext = createContext<DesignerContextValue | null>(null);

export function useDesigner(): DesignerContextValue {
  const v = useContext(DesignerContext);
  if (!v) throw new Error('useDesigner must be used inside ReportDesigner');
  return v;
}
