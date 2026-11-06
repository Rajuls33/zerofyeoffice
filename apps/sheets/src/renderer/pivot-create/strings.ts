/// Strings of the Create PivotTable flow, kept out of the shared dictionaries so
/// the feature is self-contained. English is the fallback for every language
/// that has no table here (see `pcText`). Add a language by adding a block.

const en = {
  title: 'Create PivotTable',
  chooseData: 'Choose the data that you want to analyze',
  selectRange: 'Select a table or range',
  tableRange: 'Table/Range:',
  chooseWhere: 'Choose where you want the PivotTable to be placed',
  newSheet: 'New Worksheet',
  existingSheet: 'Existing Worksheet',
  location: 'Location:',
  locationPlaceholder: "e.g. B3 or 'Sheet 2'!B3",
  fieldCount: '{rows} rows × {columns} columns — {fields} fields',
  errEmpty: 'Enter the range that holds your data.',
  errInvalid: 'That is not a valid range. Use a form like A1:D100.',
  errOneRow: 'The range needs a header row and at least one row of data.',
  errOneCell: 'Select more than one cell: a header row plus your data, like A1:D100.',
  errNoFields: 'No column headers found in that range.',
  errUnknownSheet: 'There is no worksheet named "{name}".',
  errLocationEmpty: 'Enter the cell where the PivotTable should start.',
  errLocationInvalid: 'That is not a valid cell. Use a form like B3.',
  errLocationInSource: 'The PivotTable cannot start inside its own source data.',
  errLocked:
    'The workbook structure is protected, so a new worksheet cannot be added. Choose Existing Worksheet instead.',
  ok: 'OK',
  filterMenu: 'Filter…',
  allItems: '(All)',
  filterTitle: 'Filter: {name}',
  selectAll: '(Select All)',
  searchItems: 'Search',
  clearFilter: 'Clear Filter',
  needOneItem: 'Keep at least one item ticked.',
  filterButton: 'Filter {name}',
  designTitle: 'Design',
  grandTotalRow: 'Grand total row (bottom)',
  grandTotalColumn: 'Grand total column (right)',
  subtotals: 'Subtotals',
  searchFields: 'Search fields',
  noFieldMatch: 'No matching fields',
  cancel: 'Cancel',
  created: 'PivotTable created on {sheet}. Choose fields in the PivotTable Fields pane.',
  draftReady:
    'Ready on {sheet}. Pick fields in the PivotTable Fields pane to build the PivotTable.',
}

type Table = typeof en
export type PivotCreateKey = keyof Table

const zh: Table = {
  title: '创建数据透视表',
  chooseData: '请选择要分析的数据',
  selectRange: '选择一个表或区域',
  tableRange: '表/区域：',
  chooseWhere: '选择放置数据透视表的位置',
  newSheet: '新工作表',
  existingSheet: '现有工作表',
  location: '位置：',
  locationPlaceholder: "例如 B3 或 'Sheet 2'!B3",
  fieldCount: '{rows} 行 × {columns} 列 — {fields} 个字段',
  errEmpty: '请输入数据所在的区域。',
  errInvalid: '区域无效，请使用类似 A1:D100 的格式。',
  errOneRow: '区域需要包含标题行和至少一行数据。',
  errOneCell: '请选择多个单元格：标题行加数据，例如 A1:D100。',
  errNoFields: '该区域中没有找到列标题。',
  errUnknownSheet: '不存在名为“{name}”的工作表。',
  errLocationEmpty: '请输入数据透视表的起始单元格。',
  errLocationInvalid: '单元格无效，请使用类似 B3 的格式。',
  errLocationInSource: '数据透视表不能从其源数据内部开始。',
  errLocked: '工作簿结构已受保护，无法新增工作表。请改选“现有工作表”。',
  ok: '确定',
  filterMenu: '筛选…',
  allItems: '（全部）',
  filterTitle: '筛选：{name}',
  selectAll: '（全选）',
  searchItems: '搜索',
  clearFilter: '清除筛选',
  needOneItem: '至少保留一个选中项。',
  filterButton: '筛选 {name}',
  designTitle: '设计',
  grandTotalRow: '总计行（底部）',
  grandTotalColumn: '总计列（右侧）',
  subtotals: '分类汇总',
  searchFields: '搜索字段',
  noFieldMatch: '没有匹配的字段',
  cancel: '取消',
  created: '已在 {sheet} 上创建数据透视表。请在“数据透视表字段”窗格中选择字段。',
  draftReady: '已在 {sheet} 上准备就绪。请在“数据透视表字段”窗格中选择字段来生成数据透视表。',
}

const tables: Readonly<Record<string, Table>> = { en, zh }

export function pcText(
  lang: string,
  key: PivotCreateKey,
  params?: Readonly<Record<string, string | number>>,
): string {
  const template = (tables[lang] ?? en)[key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    params[name] === undefined ? whole : String(params[name]),
  )
}
