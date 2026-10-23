import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LayoutDashboardIcon } from "lucide-react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { Schemas } from "@/api/client";
import { keys } from "@/api/queries";

import { CommandPalette } from "./command-palette";

const tree: Schemas["CategoryTree"] = {
  budget_account_id: null,
  categories: [
    {
      id: 1,
      name: "餐饮",
      children: [
        {
          id: 11,
          name: "买菜",
          description: null,
          budget_account: { id: 1, name: "日常", period: "month" },
        },
      ],
    },
  ],
};

function Where() {
  const location = useLocation();
  return <output aria-label="where">{location.pathname + location.search}</output>;
}

beforeAll(() => {
  // cmdk scrolls the selected item into view; jsdom has no layout.
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe("CommandPalette", () => {
  it("jumps to a category's transactions", async () => {
    const user = userEvent.setup();
    const client = new QueryClient();
    client.setQueryData(keys.categories(null), tree);
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <Where />
                  <CommandPalette
                    pages={[{ to: "/dashboard", label: "概览", icon: LayoutDashboardIcon }]}
                    onClose={onClose}
                    onShortcuts={() => {}}
                  />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await user.type(screen.getByRole("combobox"), "买菜");
    await user.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByLabelText("where")).toHaveTextContent("/transactions?category=11");
  });
});
