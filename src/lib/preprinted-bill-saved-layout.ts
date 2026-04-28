import type { PreprintedBillPrintModel } from "@/lib/preprinted-bill-print";
import { formatCompactPrintDate } from "@/lib/preprinted-bill-date-format";
import {
  PREPRINTED_BILL_TEST_FIELD_SPECS,
  type PreprintedBillTestFieldContext,
} from "@/lib/preprinted-bill-test-layout";
import {
  readFactoryPrintFieldLayout,
  resolvePrintFieldSpec,
  type PrintFieldRect,
} from "@/lib/print-field-layout";
import { PREPRINTED_BILL_TEST_LAYOUT_SCOPE } from "@/lib/preprinted-bill-test-layout";
import { getFactoryPrintLabel } from "@/lib/factory-profile";

export interface ResolvedSavedPreprintedBillField {
  id: string;
  className?: string;
  textAlign?: "left" | "right" | "center";
  text: string;
  visible: boolean;
  rect: PrintFieldRect;
}

function buildFieldContext(
  model: PreprintedBillPrintModel,
  factoryKey: string
): PreprintedBillTestFieldContext {
  return {
    factoryPrintLabel: getFactoryPrintLabel(factoryKey),
    customerPrintText: `${model.data.customer.id} ${model.customerName}`,
    formattedTestDate: formatCompactPrintDate(model.data.saleDate),
    isReturnPrint: model.data.transactionKind === "return",
    model,
  };
}

export function resolveSavedPreprintedBillFields(
  model: PreprintedBillPrintModel,
  factoryKey: string
): ResolvedSavedPreprintedBillField[] {
  const fieldContext = buildFieldContext(model, factoryKey);
  const savedFieldLayout = readFactoryPrintFieldLayout(
    PREPRINTED_BILL_TEST_LAYOUT_SCOPE,
    factoryKey
  );

  return PREPRINTED_BILL_TEST_FIELD_SPECS.map((spec) => ({
    id: spec.id,
    className: spec.className,
    textAlign: spec.textAlign,
    text: spec.renderText(fieldContext),
    visible: spec.isVisible ? spec.isVisible(fieldContext) : true,
    rect: resolvePrintFieldSpec(spec, fieldContext, savedFieldLayout[spec.id]),
  }));
}
