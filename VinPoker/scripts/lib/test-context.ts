import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createDealer, createGameTable, createAttendance, ensureSwingConfig, cleanupTestData } from "./test-data.ts";

class TestContext {
  admin: ReturnType<typeof createClient>;
  clubId: string;

  private currentFixture: {
    dealerId?: string;
    tableId?: string;
    attId?: string;
  } = {};

  constructor(supabaseUrl: string, serviceKey: string, clubId: string) {
    this.admin = createClient(supabaseUrl, serviceKey);
    this.clubId = clubId;
  }

  async createFixture(shiftId?: string) {
    // Tạo dealer
    const dealer = await createDealer(this.admin, this.clubId);

    // Tạo bàn
    const table = await createGameTable(this.admin, this.clubId, shiftId);

    // Tạo attendance
    const att = await createAttendance(this.admin, dealer.id, shiftId);

    // Đảm bảo swing_config tồn tại
    await ensureSwingConfig(this.admin, this.clubId);

    this.currentFixture = { dealerId: dealer.id, tableId: table.id, attId: att.id };

    return {
      dealerId: dealer.id,
      tableId: table.id,
      attId: att.id,
      dealer,
      table,
      att,
    };
  }

  async cleanupFixture() {
    const { dealerId, tableId } = this.currentFixture;
    if (dealerId) {
      await cleanupTestData(this.admin, dealerId, tableId);
    }
    this.currentFixture = {};
  }

  destroy() {
    // Cleanup resources if needed
  }
}
