import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SupplyRequestDetailPage from "@/app/(supply)/supply/requests/[id]/page";

vi.mock("@/components/supply/shell", () => ({
  SupplyPageHeader: ({
    title,
    description,
    actions,
  }: {
    title: string;
    description?: string;
    actions?: React.ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {actions}
    </div>
  ),
}));

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "42" }),
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SupplyRequestDetailPage", () => {
  beforeEach(() => {
    pushMock.mockReset();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url === "/api/supply/requests/42") {
          return jsonResponse({
            id: 42,
            requestRef: "REQ-TEST",
            factoryKey: "default",
            requestType: "cross_factory",
            targetFactoryKey: null,
            requesterName: "tester",
            status: "draft",
            note: null,
            approverSignature: null,
            approvedAt: null,
            fulfilledAt: null,
            createdAt: "2026-05-03T11:00:00.000Z",
            items: [],
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows '-' when cross_factory has no source selected", async () => {
    render(<SupplyRequestDetailPage />);

    await waitFor(() => {
      expect(screen.getByText("รายละเอียดใบเบิก")).toBeInTheDocument();
    });

    const sourceFactoryLabel = screen.getByText("โรงงานต้นทาง");
    const sourceFactoryCard = sourceFactoryLabel.parentElement;

    expect(sourceFactoryCard).not.toBeNull();
    expect(within(sourceFactoryCard as HTMLElement).getByText("-")).toBeInTheDocument();
    expect(within(sourceFactoryCard as HTMLElement).queryByText("default")).not.toBeInTheDocument();
  });
});
