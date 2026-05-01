import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupplyShell } from "@/components/supply/shell";
import SupplyOverviewPage from "@/app/(supply)/supply/page";
import { writeUIScale } from "@/lib/ui-scale";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const replaceMock = vi.fn();
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/supply",
  useRouter: () => ({
    replace: replaceMock,
    push: pushMock,
  }),
}));

const setThemeMock = vi.fn();

vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: "light",
    setTheme: setThemeMock,
  }),
}));

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SupplyShell", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    pushMock.mockReset();
    setThemeMock.mockReset();
    window.localStorage.clear();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

        if (url === "/api/auth") {
          return jsonResponse({
            id: 1,
            username: "admin",
            role: "admin",
            factoryKey: "main",
          });
        }

        if (url === "/api/factory") {
          return jsonResponse({
            current: "main",
            factories: [{ key: "main", name: "Main Factory" }],
          });
        }

        return jsonResponse([]);
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps sidebar controls in a dedicated footer outside the scrollable menu area", async () => {
    render(
      <SupplyShell>
        <div>Supply content</div>
      </SupplyShell>
    );

    await waitFor(() => {
      expect(screen.getByText("ขนาดตัวอักษร")).toBeInTheDocument();
    });

    const sidebar = screen.getByTestId("supply-sidebar");
    const scrollArea = screen.getByTestId("supply-sidebar-scroll");
    const footer = screen.getByTestId("supply-sidebar-footer");

    expect(sidebar).toHaveClass("flex", "flex-col");
    expect(sidebar).toHaveClass("md:w-56", "md:fixed");
    expect(scrollArea).toHaveClass("flex-1", "min-h-0", "overflow-y-auto");
    expect(within(scrollArea).getByText("Overview")).toBeInTheDocument();
    expect(within(scrollArea).getByText("กติกาสำคัญ")).toBeInTheDocument();
    expect(within(footer).getByText("ขนาดตัวอักษร")).toBeInTheDocument();
    expect(within(footer).getByText("TH")).toBeInTheDocument();
    expect(within(footer).getByRole("button", { name: "ออก" })).toBeInTheDocument();
    expect(within(scrollArea).queryByText("ขนาดตัวอักษร")).not.toBeInTheDocument();
  });

  it("applies the selected ui scale to the supply shell via the body attribute", async () => {
    render(
      <SupplyShell>
        <div className="ui-scale-page-title">Supply content</div>
      </SupplyShell>
    );

    await waitFor(() => {
      expect(document.body).toHaveAttribute("data-dashboard-ui-scale", "normal");
    });

    act(() => {
      writeUIScale("large");
    });

    await waitFor(() => {
      expect(document.body).toHaveAttribute("data-dashboard-ui-scale", "large");
    });
  });

  it("includes dark theme styles for the shell and overview cards", async () => {
    render(
      <SupplyShell>
        <SupplyOverviewPage />
      </SupplyShell>
    );

    await waitFor(() => {
      expect(screen.getByText("Quick actions")).toBeInTheDocument();
    });

    expect(screen.getByTestId("supply-sidebar").className).toContain("dark:bg-gray-900");
    expect(screen.getByTestId("supply-main").className).not.toContain("md:ml-56");
    expect(screen.getAllByText("Overview")[1].className).toContain("dark:text-slate-100");
    expect(screen.getByText("Quick actions").closest('[class*="dark:border-slate-800"]')).not.toBeNull();
  });
});
