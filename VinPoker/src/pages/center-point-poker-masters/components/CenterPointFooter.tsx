import { CheckCircle2, Mail, MapPin, Phone, Send } from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type CenterPointFooterProps = { onNavigate: (target: string) => void };

const quickLinks = ["Schedule", "Player Guide", "Tournament Rules", "FAQ", "Contact Us"];

export function CenterPointFooter({ onNavigate }: CenterPointFooterProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [subscribed, setSubscribed] = useState(false);

  const submitSubscription = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setSubscribed(false);
      setError("Enter a valid email address to subscribe.");
      return;
    }
    setError("");
    setSubscribed(true);
    toast.success("You are on the Center Point update list.");
  };

  return (
    <footer className="cp-footer" id="about" data-cp-section="about">
      <div className="cp-shell cp-footer__grid">
        <div className="cp-footer__brand"><span className="cp-brand__monogram">CPM</span><strong>Center Point<br />Poker Masters</strong><p><MapPin aria-hidden="true" />27 Lê Văn Lương, Thanh Xuân, Hà Nội</p></div>
        <div><h2>Quick links</h2><ul>{quickLinks.map((link) => <li key={link}><button type="button" onClick={() => onNavigate(link === "Schedule" ? "events" : link === "Player Guide" ? "player-guide" : "news")}>{link}</button></li>)}</ul></div>
        <div><h2>Support</h2><ul className="cp-footer__support"><li><Phone aria-hidden="true" />+84 123 456 789</li><li><Mail aria-hidden="true" />info@centerpointpoker.vn</li><li><CheckCircle2 aria-hidden="true" />Live chat support<br /><span>24/7 available</span></li></ul></div>
        <div><h2>Stay updated</h2><p>Subscribe to get the latest updates.</p><form className="cp-subscribe" noValidate onSubmit={submitSubscription}><label className="sr-only" htmlFor="center-point-email">Email address</label><Input id="center-point-email" value={email} type="email" placeholder="Enter your email" aria-invalid={Boolean(error)} aria-describedby={error ? "center-point-email-error" : undefined} onChange={(event) => setEmail(event.target.value)} /><Button className="cp-button cp-button--primary" type="submit">Subscribe <Send aria-hidden="true" /></Button></form>{error && <p className="cp-form-error" id="center-point-email-error" role="alert">{error}</p>}{subscribed && <p className="cp-form-success" role="status">Subscription confirmed locally—no email was sent.</p>}</div>
      </div>
      <div className="cp-shell cp-footer__bottom"><span>© 2026 Center Point Poker Masters. All rights reserved.</span><span>Responsible gaming <b>18+</b></span></div>
    </footer>
  );
}
