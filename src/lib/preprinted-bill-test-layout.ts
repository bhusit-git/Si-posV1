import {
  formatPreprintedBillAmount,
  formatPreprintedBillQty,
  PREPRINTED_BILL_COLUMNS,
  PREPRINTED_BILL_DERIVED,
  PREPRINTED_BILL_LAYOUT,
  type PreprintedBillPrintModel,
} from "@/lib/preprinted-bill-print";
import type { PrintFieldSpec } from "@/lib/print-field-layout";

export const PREPRINTED_BILL_TEST_LAYOUT_SCOPE = "preprinted-bill-test";
export const PREPRINTED_BILL_TEST_CUSTOMER_FIELD_WIDTH_MM = 44;

export interface PreprintedBillTestFieldContext {
  factoryPrintLabel: string;
  customerPrintText: string;
  formattedTestDate: string;
  isReturnPrint: boolean;
  model: PreprintedBillPrintModel;
}

export type PreprintedBillTestFieldSpec = PrintFieldSpec<PreprintedBillTestFieldContext> & {
  className?: string;
  editorHeightMm?: number;
  editorWidthMm?: number;
  renderText: (context: PreprintedBillTestFieldContext) => string;
  isVisible?: (context: PreprintedBillTestFieldContext) => boolean;
};

const PRODUCT_ROW_LABELS = [
  "Block ice qty",
  "Pack 20 qty",
  "Large tube 20kg qty",
  "Small tube crushed qty",
  "Large tube crushed qty",
  "Small tube 20kg qty",
] as const;

const BAG_ROW_LABELS = [
  "Line 7",
  "Bags out",
  "Bags return",
  "Net bags",
] as const;

function buildProductRowY(index: number): (context: PreprintedBillTestFieldContext) => number {
  return () => PREPRINTED_BILL_LAYOUT.ITEM_START_Y_MM + index * PREPRINTED_BILL_LAYOUT.ROW_SPACING_MM;
}

function buildBagRowY(index: number): (context: PreprintedBillTestFieldContext) => number {
  return (context) => context.model.layout.bagStartY + index * PREPRINTED_BILL_LAYOUT.ROW_SPACING_MM;
}

function createProductQtySpec(index: number): PreprintedBillTestFieldSpec {
  const getY = buildProductRowY(index);
  return {
    id: `productQty${index + 1}`,
    label: PRODUCT_ROW_LABELS[index],
    className: "num",
    editorHeightMm: 6,
    editorWidthMm: 9,
    renderText: (context) => formatPreprintedBillQty(context.model.itemRows[index]?.qty ?? 0),
    getDefaultRect: (context) => ({
      xMm: PREPRINTED_BILL_COLUMNS.COL_QTY_X_MM,
      yMm: getY(context),
    }),
  };
}

function createProductAmountSpec(index: number): PreprintedBillTestFieldSpec {
  const getY = buildProductRowY(index);
  return {
    id: `productAmount${index + 1}`,
    label: PRODUCT_ROW_LABELS[index].replace("qty", "amount"),
    className: "num",
    editorHeightMm: 6,
    widthEditable: true,
    textAlign: "right",
    renderText: (context) => formatPreprintedBillAmount(context.model.itemRows[index]?.amount ?? 0),
    getDefaultRect: (context) => ({
      xMm: PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM,
      yMm: getY(context),
      widthMm: PREPRINTED_BILL_LAYOUT.COL_AMOUNT_WIDTH_MM,
    }),
  };
}

function createBagQtySpec(index: number): PreprintedBillTestFieldSpec {
  const getY = buildBagRowY(index);
  return {
    id: `bagQty${index + 1}`,
    label: `${BAG_ROW_LABELS[index]} qty`,
    className: "num",
    editorHeightMm: 6,
    editorWidthMm: index === 0 ? 9 : PREPRINTED_BILL_LAYOUT.BAG_QTY_WIDTH_MM,
    textAlign: index === 0 ? undefined : "right",
    renderText: (context) => formatPreprintedBillQty(context.model.bagRows[index]?.qty ?? 0),
    getDefaultRect: (context) => ({
      xMm:
        index === 0
          ? PREPRINTED_BILL_COLUMNS.COL_QTY_X_MM
          : PREPRINTED_BILL_DERIVED.BAG_QTY_X_MM -
            PREPRINTED_BILL_LAYOUT.BAG_QTY_LEFT_SHIFT_MM +
            PREPRINTED_BILL_LAYOUT.BAG_SECTION_SHIFT_MM,
      yMm: getY(context),
      widthMm: index === 0 ? undefined : PREPRINTED_BILL_LAYOUT.BAG_QTY_WIDTH_MM,
    }),
  };
}

function createBagAmountSpec(index: number): PreprintedBillTestFieldSpec {
  const getY = buildBagRowY(index);
  return {
    id: `bagAmount${index + 1}`,
    label: `${BAG_ROW_LABELS[index]} amount`,
    className: "num",
    editorHeightMm: 6,
    widthEditable: true,
    textAlign: "right",
    renderText: (context) => formatPreprintedBillAmount(context.model.bagRows[index]?.amount ?? 0),
    getDefaultRect: (context) => ({
      xMm: PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM,
      yMm: getY(context),
      widthMm: PREPRINTED_BILL_LAYOUT.COL_AMOUNT_WIDTH_MM,
    }),
  };
}

export const PREPRINTED_BILL_TEST_FIELD_SPECS: PreprintedBillTestFieldSpec[] = [
  {
    id: "factoryName",
    label: "Factory name",
    className: "factory-name-field",
    editorHeightMm: 5,
    editorWidthMm: PREPRINTED_BILL_COLUMNS.DATE_BLOCK_WIDTH_MM,
    textAlign: "right",
    renderText: (context) => context.factoryPrintLabel,
    isVisible: (context) => context.factoryPrintLabel.trim().length > 0,
    getDefaultRect: () => ({
      xMm: PREPRINTED_BILL_LAYOUT.CONTENT_LEFT_MM - 20,
      yMm: 22,
      widthMm: PREPRINTED_BILL_COLUMNS.DATE_BLOCK_WIDTH_MM,
    }),
  },
  {
    id: "returnFlag",
    label: "Return flag",
    className: "return-flag-field",
    editorHeightMm: 6,
    editorWidthMm: PREPRINTED_BILL_TEST_CUSTOMER_FIELD_WIDTH_MM,
    widthEditable: true,
    renderText: () => "RETURN",
    isVisible: (context) => context.isReturnPrint,
    getDefaultRect: () => ({
      xMm: PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM,
      yMm: 18,
      widthMm: PREPRINTED_BILL_TEST_CUSTOMER_FIELD_WIDTH_MM,
    }),
  },
  {
    id: "customer",
    label: "Customer",
    className: "customer-field",
    editorHeightMm: 6,
    editorWidthMm: PREPRINTED_BILL_TEST_CUSTOMER_FIELD_WIDTH_MM,
    widthEditable: true,
    renderText: (context) => context.customerPrintText,
    isVisible: (context) => context.customerPrintText.trim().length > 0,
    getDefaultRect: () => ({
      xMm: PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM - 20,
      yMm: PREPRINTED_BILL_LAYOUT.CUSTOMER_Y_MM,
      widthMm: PREPRINTED_BILL_TEST_CUSTOMER_FIELD_WIDTH_MM,
    }),
  },
  {
    id: "date",
    label: "Date",
    className: "date-field",
    editorHeightMm: 6,
    editorWidthMm: PREPRINTED_BILL_COLUMNS.DATE_BLOCK_WIDTH_MM,
    widthEditable: true,
    textAlign: "right",
    renderText: (context) => context.formattedTestDate,
    isVisible: (context) => context.formattedTestDate.trim().length > 0,
    getDefaultRect: () => ({
      xMm: PREPRINTED_BILL_LAYOUT.CONTENT_LEFT_MM,
      yMm: PREPRINTED_BILL_LAYOUT.DATE_Y_MM,
      widthMm: PREPRINTED_BILL_COLUMNS.DATE_BLOCK_WIDTH_MM,
    }),
  },
  ...Array.from({ length: 6 }, (_, index) => createProductQtySpec(index)),
  ...Array.from({ length: 6 }, (_, index) => createProductAmountSpec(index)),
  {
    id: "bagLabel1",
    label: "Line 7 label",
    className: "line7-label-field",
    editorHeightMm: 6,
    editorWidthMm: PREPRINTED_BILL_DERIVED.ITEM_LABEL_WIDTH_MM,
    widthEditable: true,
    renderText: (context) => context.model.bagRows[0]?.item ?? "",
    getDefaultRect: (context) => ({
      xMm: PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM,
      yMm: context.model.layout.bagStartY,
      widthMm: PREPRINTED_BILL_DERIVED.ITEM_LABEL_WIDTH_MM,
    }),
  },
  ...Array.from({ length: 4 }, (_, index) => createBagQtySpec(index)),
  ...Array.from({ length: 4 }, (_, index) => createBagAmountSpec(index)),
  {
    id: "totalAmount",
    label: "Total amount",
    className: "num",
    editorHeightMm: 6,
    textAlign: "right",
    renderText: (context) => formatPreprintedBillAmount(context.model.totalAmount, false),
    getDefaultRect: (context) => ({
      xMm: PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM,
      yMm: context.model.layout.totalY,
      widthMm: PREPRINTED_BILL_LAYOUT.COL_AMOUNT_WIDTH_MM,
    }),
  },
  {
    id: "partialPaidLabel",
    label: "Paid label",
    className: "partial-label",
    editorHeightMm: 4,
    editorWidthMm: PREPRINTED_BILL_DERIVED.ITEM_LABEL_WIDTH_MM,
    renderText: () => "รับแล้ว",
    isVisible: (context) => context.model.partialPaidAmount != null,
    getDefaultRect: (context) => ({
      xMm: PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM,
      yMm: context.model.layout.partialPaidY,
      widthMm: PREPRINTED_BILL_DERIVED.ITEM_LABEL_WIDTH_MM,
    }),
  },
  {
    id: "partialPaidAmount",
    label: "Paid amount",
    className: "partial-num",
    editorHeightMm: 4,
    textAlign: "right",
    renderText: (context) =>
      formatPreprintedBillAmount(context.model.partialPaidAmount ?? 0, false),
    isVisible: (context) => context.model.partialPaidAmount != null,
    getDefaultRect: (context) => ({
      xMm: PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM,
      yMm: context.model.layout.partialPaidY,
      widthMm: PREPRINTED_BILL_LAYOUT.COL_AMOUNT_WIDTH_MM,
    }),
  },
  {
    id: "partialRemainingLabel",
    label: "Remaining label",
    className: "partial-label",
    editorHeightMm: 4,
    editorWidthMm: PREPRINTED_BILL_DERIVED.ITEM_LABEL_WIDTH_MM,
    renderText: () => "ค้างเหลือ",
    isVisible: (context) => context.model.partialRemainingAmount != null,
    getDefaultRect: (context) => ({
      xMm: PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM,
      yMm: context.model.layout.partialRemainingY,
      widthMm: PREPRINTED_BILL_DERIVED.ITEM_LABEL_WIDTH_MM,
    }),
  },
  {
    id: "partialRemainingAmount",
    label: "Remaining amount",
    className: "partial-num",
    editorHeightMm: 4,
    textAlign: "right",
    renderText: (context) =>
      formatPreprintedBillAmount(context.model.partialRemainingAmount ?? 0, false),
    isVisible: (context) => context.model.partialRemainingAmount != null,
    getDefaultRect: (context) => ({
      xMm: PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM,
      yMm: context.model.layout.partialRemainingY,
      widthMm: PREPRINTED_BILL_LAYOUT.COL_AMOUNT_WIDTH_MM,
    }),
  },
  {
    id: "time",
    label: "Time",
    className: "num",
    editorHeightMm: 6,
    editorWidthMm: 18,
    renderText: (context) => context.model.timeText,
    isVisible: (context) => context.model.timeText.trim().length > 0,
    getDefaultRect: (context) => ({
      xMm: PREPRINTED_BILL_COLUMNS.SIGN_LEFT_X_MM,
      yMm: context.model.layout.timeY,
    }),
  },
];
