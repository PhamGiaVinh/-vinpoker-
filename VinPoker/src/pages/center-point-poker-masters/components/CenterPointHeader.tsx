import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { navigationItems } from "../centerPointContent";

type CenterPointHeaderProps = {
  activeSection: string;
  onNavigate: (target: string) => void;
  onRegister: () => void;
};

export function CenterPointHeader({ activeSection, onNavigate, onRegister }: CenterPointHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  const handleNavigate = (target: string) => {
    onNavigate(target);
    setMenuOpen(false);
  };

  return (
    <header className="cp-header">
      <div className="cp-shell cp-header__inner">
        <button className="cp-brand" type="button" onClick={() => handleNavigate("home")} aria-label="Center Point Poker Masters home">
          <span className="cp-brand__monogram">CPM</span>
          <span className="cp-brand__copy"><strong>Center Point</strong><small>Poker Masters</small></span>
        </button>

        <nav className="cp-desktop-nav" aria-label="Primary navigation">
          {navigationItems.map((item) => (
            <button
              className={activeSection === item.target ? "is-active" : undefined}
              key={item.label}
              type="button"
              onClick={() => handleNavigate(item.target)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="cp-header__actions">
          <Button className="cp-button cp-button--primary cp-register-button" type="button" onClick={onRegister}>
            Register now
          </Button>
          <button
            aria-controls="center-point-mobile-menu"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            className="cp-menu-trigger"
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="cp-mobile-nav" id="center-point-mobile-menu" aria-label="Mobile navigation">
          {navigationItems.map((item) => (
            <button key={item.label} type="button" onClick={() => handleNavigate(item.target)}>
              {item.label}
            </button>
          ))}
          <Button className="cp-button cp-button--primary" type="button" onClick={() => { setMenuOpen(false); onRegister(); }}>
            Register now
          </Button>
        </nav>
      )}
    </header>
  );
}
