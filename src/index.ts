import './styles.css';

export * from './core';

export { ReportViewer, type ReportViewerProps, type ReportViewerHandle } from './viewer/ReportViewer';
export { useReportDocument, type UseReportDocumentOptions, type ReportDocumentState } from './viewer/useReportDocument';
export { ReportDesigner, type ReportDesignerProps, type ReportDesignerHandle } from './designer/ReportDesigner';
export type { ToolboxConfig } from './designer/registry';
export { ReportStudio, type ReportStudioProps, type StarterTemplate } from './studio/ReportStudio';

export {
  EasyReportProvider,
  LIGHT_THEME,
  DARK_THEME,
  themeToCssVars,
  type EasyReportConfig,
  type ThemeTokens,
  type ElementTypeDef,
  type PropertyDescriptor,
  type PropertyEditorType,
  type ToolbarItem,
  type ToolbarConfig,
  type ToolboxItem,
} from './ui/config';
export { DEFAULT_LABELS, type Labels } from './ui/labels';
export { DEFAULT_COMPONENTS, type UIComponents, type ButtonProps, type InputProps, type SelectProps, type CheckboxProps, type TextAreaProps, type DialogProps } from './ui/primitives';
export { SvgIcon, type IconName } from './ui/icons';
