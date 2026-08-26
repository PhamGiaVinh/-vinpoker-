import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CenterPointPokerMastersPage from "@/pages/CenterPointPokerMastersPage";

describe("CenterPointPokerMastersPage", () => {
  it("renders the public marketing experience and opens the registration dialog", () => {
    render(<CenterPointPokerMastersPage />);
    expect(screen.getByRole("heading", { name: /poker masters/i, level: 1 })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /register now/i })[0]);
    expect(screen.getByRole("dialog")).toHaveTextContent(/register for season 3/i);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens an event detail dialog and validates the local subscription form", () => {
    render(<CenterPointPokerMastersPage />);
    fireEvent.click(screen.getAllByRole("button", { name: /view details/i })[0]);
    expect(screen.getByRole("dialog")).toHaveTextContent(/kick off event/i);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /subscribe/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/valid email/i);
  });

  it("scrolls when schedule is requested", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<CenterPointPokerMastersPage />);
    fireEvent.click(screen.getByRole("button", { name: /view schedule/i }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });
});
