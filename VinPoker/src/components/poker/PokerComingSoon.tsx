// src/components/poker/PokerComingSoon.tsx
// GE-2D — the production-safe placeholder shown whenever the online-poker feature
// flag (FEATURES.onlinePoker) is OFF. This is what real users see; the mock shell
// is reachable only when the flag is flipped (locally, for review/dev).

import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spade, Lock } from 'lucide-react';

export function PokerComingSoon() {
  return (
    <div className="container mx-auto flex min-h-[60vh] items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 text-center space-y-4 border-primary/20">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <Spade className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold">Poker Online</h1>
        <p className="text-muted-foreground">
          Sảnh chơi poker online (chip ảo, alpha nội bộ) đang được phát triển và{' '}
          <span className="text-foreground font-medium">chưa mở</span>. Tính năng sẽ
          xuất hiện ở đây khi sẵn sàng.
        </p>
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          <span>Play-money · server-authoritative · đang trong giai đoạn dựng giao diện</span>
        </div>
        <Button asChild variant="outline" className="mt-2">
          <Link to="/">Về trang chủ</Link>
        </Button>
      </Card>
    </div>
  );
}
