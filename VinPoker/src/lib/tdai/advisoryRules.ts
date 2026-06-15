import type { TdRule } from "./types";

// Advisory corpus beyond table rulings — operations, floor procedure, and
// general strategy. These are NON-AUTHORITATIVE best-practice summaries
// (paraphrased, advisory). They are NOT verbatim TDA text and carry NO rule
// numbers, so they can never trip the fabricated-rule-number guard in
// validateAnswer. Every entry is source:"house" / citationKind:"house" and the
// label names its domain (VẬN HÀNH / FLOOR / CHIẾN THUẬT), not a rule number.
//
// These widen what the TD assistant can advise on so it works as a real
// consultant, not just a dispute lookup. The model still answers ONLY from the
// entries retrieval surfaces — the corpus is the leash.

// ── OPERATIONS — running the tournament ───────────────────────────────────
const OPERATIONS_RULES: TdRule[] = [
  {
    id: "ops-blind-structure",
    topicEn: "Blind structure / level length",
    topicVi: "Cơ cấu mù & độ dài level",
    summaryEn:
      "Pick level length and blind jumps to fit the target tournament duration: deeper/slower for marquee events, faster for daily/turbo. Keep jumps smooth (roughly ×1.3–1.5) to avoid sudden stack-to-blind cliffs.",
    summaryVi:
      "Chọn độ dài level và bước nhảy mù theo thời lượng mong muốn: chậm/sâu cho giải lớn, nhanh cho giải ngày/turbo. Giữ bước nhảy mượt (khoảng ×1.3–1.5) để tránh nhảy mù quá gắt làm vỡ tỉ lệ stack/mù.",
    keywords: ["cơ cấu mù", "cấu trúc mù", "blind structure", "độ dài level", "level length", "nhảy mù", "tăng mù", "bước nhảy mù", "blind level", "structure giải"],
    suggestionVi:
      "Cân nhắc thời lượng giải và stack khởi điểm để chọn độ dài level + bước nhảy mù hợp lý; tránh bước nhảy quá gắt — TD/chủ giải duyệt cơ cấu trước khi mở đăng ký.",
    playerWordingVi: "Cơ cấu mù của giải đã được công bố trong thể lệ; mọi điều chỉnh (nếu có) sẽ được thông báo tới cả phòng.",
    citationLabel: "VẬN HÀNH",
    citationKind: "house",
    source: "house",
    category: "operations",
  },
  {
    id: "ops-color-up",
    topicEn: "Color-up / chip race",
    topicVi: "Gom chip & đua chip lẻ (color-up)",
    summaryEn:
      "Color up the smallest denomination once it is no longer needed for blinds/antes. Race off odd chips by dealing one card per remaining small chip (highest card wins the colored-up chip); never leave a player with zero chips if they had any.",
    summaryVi:
      "Gom mệnh giá nhỏ nhất khi nó không còn cần cho mù/ante. Đua chip lẻ bằng cách chia một lá bài cho mỗi chip nhỏ còn lại (lá cao nhất nhận chip gom); người còn chip thì không bị về 0 chip sau khi đua.",
    keywords: ["gom chip", "color up", "colorup", "đua chip", "chip race", "đổi chip", "race chip", "bỏ chip nhỏ", "gom mệnh giá", "đua chip lẻ"],
    suggestionVi:
      "Gom mệnh giá nhỏ khi không còn cần; đua chip lẻ công khai trước bàn, lá cao nhận chip — TD giám sát quá trình đua chip.",
    playerWordingVi: "Mình sẽ gom chip mệnh giá nhỏ và đua chip lẻ công khai ngay tại bàn, mời anh/chị theo dõi để cùng minh bạch.",
    citationLabel: "VẬN HÀNH",
    citationKind: "house",
    source: "house",
    category: "operations",
  },
  {
    id: "ops-table-balance",
    topicEn: "Table balancing",
    topicVi: "Cân bàn (table balancing)",
    summaryEn:
      "Keep tables within one player of each other. Move the player who is due to be the next big blind from the longest table to the open seat (taking the worst position), so nobody skips or doubles a blind unfairly.",
    summaryVi:
      "Giữ chênh lệch giữa các bàn không quá 1 người. Khi cân bàn, chuyển người sắp tới lượt big blind ở bàn đông nhất sang ghế trống (nhận vị trí xấu nhất) để không ai bị bỏ qua hay đóng mù hai lần bất công.",
    keywords: ["cân bàn", "table balance", "balancing", "chuyển bàn cân", "dồn bàn", "điều người", "move balance", "cân người giữa bàn", "đông người quá"],
    suggestionVi:
      "Chuyển người sắp tới big blind ở bàn đông nhất sang ghế trống ở bàn ít người, nhận vị trí xấu nhất — áp dụng nhất quán theo luật giải.",
    playerWordingVi: "Để các bàn cân số người, em xin mời anh/chị chuyển sang bàn còn ghế trống; anh/chị mang theo nguyên chip của mình ạ.",
    citationLabel: "VẬN HÀNH",
    citationKind: "house",
    source: "house",
    category: "operations",
  },
  {
    id: "ops-break-table",
    topicEn: "Breaking a table / redraw",
    topicVi: "Gộp bàn / rút thăm lại (break table)",
    summaryEn:
      "When a table must be broken, scatter its players to the open seats by a fair method (random draw or fixed fill order) and break the table that brings the field closest to balanced. Players keep their full stacks.",
    summaryVi:
      "Khi cần gộp một bàn, rải người của bàn đó vào các ghế trống theo cách công bằng (rút thăm hoặc thứ tự lấp cố định) và chọn gộp bàn nào giúp cả giải cân nhất. Người chơi giữ nguyên toàn bộ chip.",
    keywords: ["gộp bàn", "break table", "đập bàn", "phá bàn", "rút thăm bàn", "redraw", "rải người", "đóng bàn dồn người", "gộp bàn cuối"],
    suggestionVi:
      "Chọn bàn để gộp sao cho cả giải cân nhất; rải người theo phương pháp công bằng đã công bố; giữ nguyên chip — TD điều phối.",
    playerWordingVi: "Bàn mình sẽ được gộp để dồn người; em mời anh/chị bốc ghế mới và mang theo nguyên chip của mình nhé.",
    citationLabel: "VẬN HÀNH",
    citationKind: "house",
    source: "house",
    category: "operations",
  },
  {
    id: "ops-late-reg",
    topicEn: "Late registration & re-entry window",
    topicVi: "Đăng ký muộn & cửa re-entry",
    summaryEn:
      "Late registration and re-entry close at a fixed, pre-announced point (e.g. end of a level). Announce the closing level clearly and warn the room one level ahead. A busted player may re-enter only while the window is open.",
    summaryVi:
      "Đăng ký muộn và re-entry đóng tại mốc cố định đã công bố (ví dụ hết level X). Thông báo rõ level đóng và nhắc cả phòng trước một level. Người bị loại chỉ được re-entry khi cửa còn mở.",
    keywords: ["đăng ký muộn", "late reg", "late registration", "re-entry", "reentry", "tái đăng ký", "cửa đăng ký", "đóng đăng ký", "hết giờ đăng ký", "vào muộn"],
    suggestionVi:
      "Bám mốc đóng đã công bố; thông báo level đóng rõ ràng và nhắc trước một level; chỉ nhận re-entry khi cửa còn mở — TD chốt thời điểm.",
    playerWordingVi: "Đăng ký muộn/re-entry sẽ đóng vào cuối level đã thông báo; anh/chị muốn vào thêm thì tranh thủ trước thời điểm đó giúp em nhé.",
    citationLabel: "VẬN HÀNH",
    citationKind: "house",
    source: "house",
    category: "operations",
  },
  {
    id: "ops-payouts-icm",
    topicEn: "Payouts, ICM & deals (chops)",
    topicVi: "Cơ cấu trả thưởng, ICM & chia tiền (deal)",
    summaryEn:
      "Pay a standard percentage ladder based on the field size. If finalists want to deal, the floor can compute an ICM or chip-chop suggestion, but every remaining player must agree; the trophy/last bit is usually still played for.",
    summaryVi:
      "Trả thưởng theo thang phần trăm chuẩn tùy số lượng người tham gia. Nếu các finalist muốn chia tiền, floor có thể tính gợi ý theo ICM hoặc chip-chop, nhưng phải có sự đồng thuận của tất cả người còn lại; phần cúp/khoản chốt thường vẫn chơi tiếp.",
    keywords: ["trả thưởng", "cơ cấu giải thưởng", "payout", "payout structure", "icm", "chia tiền", "deal bàn chung kết", "chop", "thỏa thuận chia", "chip chop", "đàm phán chia tiền"],
    suggestionVi:
      "Dùng thang trả thưởng đã công bố; nếu chia tiền, tính gợi ý ICM/chip-chop và chỉ chốt khi tất cả đồng thuận, ghi lại thỏa thuận — TD chủ trì.",
    playerWordingVi: "Nếu các anh/chị muốn thỏa thuận chia tiền, em sẽ tính gợi ý theo ICM và chỉ áp dụng khi tất cả cùng đồng ý ạ.",
    citationLabel: "VẬN HÀNH",
    citationKind: "house",
    source: "house",
    category: "operations",
  },
  {
    id: "ops-big-blind-ante",
    topicEn: "Big blind ante structure",
    topicVi: "Ante theo big blind (big blind ante)",
    summaryEn:
      "With a big-blind ante, only the player in the big blind posts the table ante for everyone, which speeds the game and avoids missed antes. Announce when the format is in use and how the ante scales with the level.",
    summaryVi:
      "Với big blind ante, chỉ người ở vị trí big blind đóng ante chung cho cả bàn, giúp ván nhanh hơn và tránh sót ante. Thông báo khi áp dụng và cách ante tăng theo level.",
    keywords: ["big blind ante", "bb ante", "ante chung", "ante big blind", "đóng ante", "ante theo bàn", "ante format"],
    suggestionVi:
      "Áp dụng nhất quán: chỉ người big blind đóng ante chung; công bố mức ante theo level — TD/dealer kiểm tra việc đóng ante mỗi ván.",
    playerWordingVi: "Giải dùng big blind ante: chỉ người ở vị trí big blind đóng ante chung cho cả bàn thôi ạ.",
    citationLabel: "VẬN HÀNH",
    citationKind: "house",
    source: "house",
    category: "operations",
  },
  {
    id: "ops-registration-seat-draw",
    topicEn: "Registration & random seat draw",
    topicVi: "Đăng ký & bốc ghế ngẫu nhiên",
    summaryEn:
      "Assign seats by a random draw at buy-in; do not let players pick seats. New entries take the next drawn seat. Keep the seat draw auditable so the field is provably random.",
    summaryVi:
      "Gán ghế bằng bốc thăm ngẫu nhiên khi buy-in; không cho người chơi tự chọn ghế. Người vào mới nhận ghế bốc kế tiếp. Lưu lại việc bốc ghế để đảm bảo minh bạch, ngẫu nhiên.",
    keywords: ["bốc ghế", "seat draw", "xếp ghế ngẫu nhiên", "random seat", "gán ghế buy-in", "chia ghế", "draw seat", "đăng ký xếp chỗ"],
    suggestionVi:
      "Bốc ghế ngẫu nhiên khi buy-in, không cho tự chọn; ghi nhận để minh bạch — cashier/floor thực hiện theo quy trình.",
    playerWordingVi: "Ghế ngồi được bốc ngẫu nhiên khi anh/chị buy-in để đảm bảo công bằng; mời anh/chị về đúng ghế đã bốc ạ.",
    citationLabel: "VẬN HÀNH",
    citationKind: "house",
    source: "house",
    category: "operations",
  },
  {
    id: "ops-clock-break-schedule",
    topicEn: "Clock & break schedule",
    topicVi: "Đồng hồ giải & lịch nghỉ giải lao",
    summaryEn:
      "Run a single authoritative tournament clock. Schedule breaks at fixed intervals (e.g. a short break every few levels, a longer dinner break), and color-up / chip counts often align to the break. Pause the clock only for floor-approved reasons.",
    summaryVi:
      "Chạy một đồng hồ giải duy nhất làm chuẩn. Lên lịch nghỉ giải lao theo khoảng cố định (ví dụ nghỉ ngắn sau vài level, nghỉ ăn dài hơn); việc gom chip/đếm chip thường gắn với giờ nghỉ. Chỉ tạm dừng đồng hồ vì lý do được floor duyệt.",
    keywords: ["đồng hồ giải", "tournament clock", "lịch nghỉ", "break giải lao", "giờ nghỉ", "nghỉ ăn", "dinner break", "tạm dừng đồng hồ", "lịch break", "schedule break"],
    suggestionVi:
      "Dùng một đồng hồ chuẩn; nghỉ theo lịch cố định đã công bố; chỉ pause khi floor duyệt — TD quản lý đồng hồ và thông báo trước mỗi giờ nghỉ.",
    playerWordingVi: "Giải sẽ nghỉ giải lao theo lịch đã công bố; em sẽ thông báo trước khi tới giờ nghỉ để anh/chị chủ động ạ.",
    citationLabel: "VẬN HÀNH",
    citationKind: "house",
    source: "house",
    category: "operations",
  },
];

// ── FLOOR — procedure & incidents (distinct from the table rulings) ────────
const FLOOR_RULES: TdRule[] = [
  {
    id: "floor-pot-award-error",
    topicEn: "Pot awarded / pushed to the wrong player",
    topicVi: "Đẩy/chung pot nhầm người",
    summaryEn:
      "If the dealer pushes the pot to the wrong player or miscounts, stop play, reconstruct the pot from the action and verifiable evidence (chip counts, cameras, table consensus), and correct it. Take time to be sure before any chips are committed to the next hand.",
    summaryVi:
      "Nếu dealer đẩy pot nhầm người hoặc đếm sai, dừng ván, dựng lại pot từ diễn biến và bằng chứng kiểm chứng được (số chip, camera, đồng thuận cả bàn) rồi điều chỉnh. Làm kỹ trước khi chip được đưa vào ván tiếp theo.",
    keywords: ["đẩy pot nhầm", "chung nhầm", "trao pot sai", "đẩy nhầm người", "đếm pot sai", "wrong pot", "chung pot nhầm", "pot sai người", "dealer đẩy nhầm"],
    suggestionVi:
      "Dừng ván, dựng lại pot từ diễn biến + bằng chứng, đối chiếu chip rồi điều chỉnh — TD chủ trì, ưu tiên xử lý trước khi sang ván mới.",
    playerWordingVi: "Có khả năng pot vừa rồi được chung chưa đúng; em xin dừng một chút để kiểm tra lại diễn biến và điều chỉnh cho chính xác ạ.",
    citationLabel: "FLOOR",
    citationKind: "house",
    source: "house",
    category: "floor",
  },
  {
    id: "floor-chip-discrepancy",
    topicEn: "Chip / stack count discrepancy",
    topicVi: "Lệch chip / sai số chip trên bàn",
    summaryEn:
      "If a stack or the chips in play do not reconcile (a player has chips of a denomination not in play, or the total is off), freeze the stacks, count carefully, and resolve to the verifiable amount. Foreign or extra chips are removed.",
    summaryVi:
      "Nếu một stack hoặc tổng chip trên bàn không khớp (người chơi có chip mệnh giá không dùng, hoặc tổng bị lệch), khóa stack, đếm cẩn thận và chốt theo số kiểm chứng được. Chip lạ hoặc dư bị thu hồi.",
    keywords: ["lệch chip", "sai số chip", "chip không khớp", "thiếu chip", "dư chip", "chip lạ", "đếm chip lệch", "stack sai", "chip discrepancy", "chip không hợp lệ"],
    suggestionVi:
      "Khóa stack, đếm lại cẩn thận, chốt theo số kiểm chứng được; thu hồi chip lạ/dư — TD giám sát việc đếm.",
    playerWordingVi: "Em cần kiểm tra lại số chip cho khớp; mong anh/chị giữ nguyên stack để em đếm và xử lý minh bạch ạ.",
    citationLabel: "FLOOR",
    citationKind: "house",
    source: "house",
    category: "floor",
  },
  {
    id: "floor-collusion-softplay",
    topicEn: "Collusion / soft play / chip dumping",
    topicVi: "Thông đồng / nương tay / chuyển chip (soft play)",
    summaryEn:
      "Collusion, soft play (not betting/raising a sure thing against a friend), and chip dumping are serious integrity violations. Observe quietly, gather evidence, and escalate to the TD; penalties can range from a warning to disqualification.",
    summaryVi:
      "Thông đồng, nương tay (không cược/raise khi chắc thắng để nhường bạn) và cố tình chuyển chip là vi phạm liêm chính nghiêm trọng. Quan sát kín, thu thập bằng chứng và báo TD; mức phạt có thể từ nhắc nhở tới loại khỏi giải.",
    keywords: ["thông đồng", "collusion", "nương tay", "soft play", "softplay", "chuyển chip", "chip dumping", "dump chip", "gian lận liêm chính", "bắt tay nhau", "chơi nhường"],
    suggestionVi:
      "Quan sát kín, thu thập bằng chứng, không kết luận vội; báo TD để quyết định mức xử lý (nhắc nhở → loại) — đây là vấn đề liêm chính.",
    playerWordingVi: "Em xin theo dõi thêm một chút để đảm bảo công bằng cho cả bàn; nếu cần, TD sẽ trao đổi riêng với anh/chị ạ.",
    citationLabel: "FLOOR",
    citationKind: "house",
    source: "house",
    category: "floor",
  },
  {
    id: "floor-angle-shoot",
    topicEn: "Angle shooting / etiquette",
    topicVi: "Tiểu xảo (angle shooting) & ứng xử",
    summaryEn:
      "Angle shooting (deceptive moves exploiting procedure rather than the rules — fake folds, ambiguous chip motions, hiding high-value chips) is handled by a warning and a clear instruction; repeat or egregious behavior escalates to a penalty.",
    summaryVi:
      "Tiểu xảo (động tác đánh lừa lợi dụng quy trình thay vì luật — giả vờ bỏ bài, đưa chip mập mờ, giấu chip mệnh giá lớn) được xử lý bằng nhắc nhở và hướng dẫn rõ ràng; tái phạm hoặc nghiêm trọng thì nâng mức phạt.",
    keywords: ["tiểu xảo", "angle", "angle shoot", "angleshooting", "giả vờ bỏ bài", "đánh lừa", "giấu chip", "chơi xấu quy trình", "tiểu xảo poker", "ứng xử bàn"],
    suggestionVi:
      "Nhắc nhở rõ ràng và hướng dẫn cách làm đúng; ghi nhận; tái phạm hoặc nghiêm trọng thì nâng mức phạt — TD quyết định.",
    playerWordingVi: "Để tránh hiểu lầm cho cả bàn, anh/chị vui lòng thao tác rõ ràng (tuyên bố trước, đưa chip một lần) giúp em nhé.",
    citationLabel: "FLOOR",
    citationKind: "house",
    source: "house",
    category: "floor",
  },
  {
    id: "floor-incident-record",
    topicEn: "Documenting an incident",
    topicVi: "Ghi nhận sự việc (incident log)",
    summaryEn:
      "For any non-trivial ruling or dispute, note the table, level, players, the action sequence, the decision made and who made it. A short written record protects the club and makes later review or appeals fair and consistent.",
    summaryVi:
      "Với mọi ruling hay tranh chấp không đơn giản, ghi lại: bàn, level, người liên quan, trình tự hành động, quyết định và ai ra quyết định. Một bản ghi ngắn bảo vệ CLB và giúp việc xem lại/khiếu nại sau này công bằng, nhất quán.",
    keywords: ["ghi nhận sự việc", "incident", "biên bản", "ghi lại tranh chấp", "log sự việc", "lưu sự việc", "báo cáo sự việc", "ghi chú ruling", "hồ sơ vụ việc"],
    suggestionVi:
      "Ghi lại bàn/level/người liên quan/trình tự/quyết định + người quyết định ngay sau khi xử lý; lưu để đối chiếu — floor thực hiện theo mẫu CLB.",
    playerWordingVi: "Em sẽ ghi lại sự việc này để đảm bảo minh bạch và nhất quán; nếu cần xem lại, CLB sẽ căn cứ vào bản ghi ạ.",
    citationLabel: "FLOOR",
    citationKind: "house",
    source: "house",
    category: "floor",
  },
];

// ── STRATEGY — general educational guidance (reference only, NOT a ruling) ──
const STRATEGY_RULES: TdRule[] = [
  {
    id: "strat-position-ranges",
    topicEn: "Position & opening ranges",
    topicVi: "Vị trí & range mở bài",
    summaryEn:
      "Position is a core edge: open tighter from early position and wider from late position and the button, because acting later gives more information. This is general guidance, not a fixed chart.",
    summaryVi:
      "Vị trí là lợi thế cốt lõi: mở bài chặt hơn ở vị trí sớm, rộng hơn ở vị trí muộn và nút bài, vì hành động sau cho nhiều thông tin hơn. Đây là định hướng chung, không phải bảng cố định.",
    keywords: ["vị trí", "position", "range mở", "opening range", "mở bài", "early position", "late position", "nút bài button", "range theo vị trí", "preflop range"],
    suggestionVi:
      "Tư vấn tham khảo: siết range ở vị trí sớm, nới ở vị trí muộn/nút bài. Không phải lời khuyên ràng buộc — người chơi tự quyết định.",
    playerWordingVi: "Định hướng chung: vị trí càng muộn thì có thể chơi rộng tay hơn vì được thấy nhiều thông tin hơn.",
    citationLabel: "CHIẾN THUẬT",
    citationKind: "house",
    source: "house",
    category: "strategy",
  },
  {
    id: "strat-pot-odds",
    topicEn: "Pot odds & equity",
    topicVi: "Pot odds & equity (tỉ lệ ăn pot)",
    summaryEn:
      "Compare the price of a call to your chance of winning: if pot odds offered are better than your equity, calling is profitable long-term. A quick rule of thumb on the flop is ~4× outs (turn+river) or ~2× per street.",
    summaryVi:
      "So sánh giá phải bỏ ra để call với khả năng thắng: nếu tỉ lệ pot tốt hơn equity của bạn thì call có lợi về lâu dài. Mẹo nhanh ở flop: ~4× số lá outs (cho cả turn+river) hoặc ~2× mỗi street.",
    keywords: ["pot odds", "tỉ lệ pot", "equity", "outs", "đếm outs", "tỉ lệ ăn", "xác suất thắng", "rule of 4 and 2", "có nên call", "giá call"],
    suggestionVi:
      "Tư vấn tham khảo: ước lượng outs, so pot odds với equity rồi quyết định call/fold. Chỉ là định hướng, không phải lời khuyên ràng buộc.",
    playerWordingVi: "Định hướng chung: nếu giá để theo (pot odds) tốt hơn khả năng về bài của mình thì theo bài thường có lợi về lâu dài.",
    citationLabel: "CHIẾN THUẬT",
    citationKind: "house",
    source: "house",
    category: "strategy",
  },
  {
    id: "strat-icm-bubble",
    topicEn: "ICM & bubble pressure",
    topicVi: "ICM & áp lực bong bóng (bubble)",
    summaryEn:
      "Near the money bubble or pay jumps, chips are worth less than their face value (ICM): survival gains value. Big stacks can apply pressure; short/medium stacks should avoid marginal spots that risk busting before a pay jump.",
    summaryVi:
      "Gần bong bóng tiền thưởng hoặc các mốc nhảy giải, chip có giá trị thấp hơn mệnh giá (ICM): sống sót có thêm giá trị. Stack lớn có thể tạo áp lực; stack ngắn/vừa nên tránh tình huống biên dễ bị loại ngay trước mốc nhảy thưởng.",
    keywords: ["icm", "bong bóng", "bubble", "áp lực bubble", "vào tiền", "mốc nhảy thưởng", "pay jump", "gần tiền", "survival", "chơi gần bubble"],
    suggestionVi:
      "Tư vấn tham khảo: gần bubble, ưu tiên sống sót, tránh tình huống biên; stack lớn có thể ép. Định hướng chung, không ràng buộc.",
    playerWordingVi: "Định hướng chung: càng gần mốc vào tiền thì việc trụ lại càng quan trọng, nên cân nhắc kỹ các pha rủi ro cao.",
    citationLabel: "CHIẾN THUẬT",
    citationKind: "house",
    source: "house",
    category: "strategy",
  },
  {
    id: "strat-stack-sizes",
    topicEn: "Short vs deep stack play",
    topicVi: "Chơi stack ngắn & stack sâu",
    summaryEn:
      "With a short stack (≲15–20 big blinds) shift toward a push/fold approach and avoid bloating pots out of position. With a deep stack, post-flop skill and position matter more and implied odds rise.",
    summaryVi:
      "Với stack ngắn (≲15–20 big blind), nghiêng về lối push/fold và tránh thổi pot lớn khi ngoài vị trí. Với stack sâu, kỹ năng hậu flop và vị trí quan trọng hơn, implied odds tăng lên.",
    keywords: ["stack ngắn", "short stack", "push fold", "đẩy all-in ngắn", "stack sâu", "deep stack", "big blind còn lại", "chơi theo stack", "M ratio", "ít chip"],
    suggestionVi:
      "Tư vấn tham khảo: stack ngắn nghiêng push/fold; stack sâu coi trọng vị trí + hậu flop. Định hướng chung, người chơi tự quyết.",
    playerWordingVi: "Định hướng chung: chip càng ít thì lối chơi push/fold càng phù hợp; chip càng sâu thì vị trí và kỹ năng hậu flop càng quan trọng.",
    citationLabel: "CHIẾN THUẬT",
    citationKind: "house",
    source: "house",
    category: "strategy",
  },
  {
    id: "strat-3bet-4bet",
    topicEn: "3-bet / 4-bet basics",
    topicVi: "Cơ bản về 3-bet / 4-bet",
    summaryEn:
      "3-betting (re-raising a raise) builds the pot with strong hands and applies pressure with selected bluffs; size it relative to the open and position. 4-betting is mostly for premium value plus a few balanced bluffs.",
    summaryVi:
      "3-bet (re-raise một cú raise) làm lớn pot với tay mạnh và tạo áp lực với một số tay bluff chọn lọc; chọn cỡ cược theo cú mở và vị trí. 4-bet chủ yếu cho tay cực mạnh, kèm vài tay bluff cân bằng.",
    keywords: ["3bet", "3-bet", "re-raise", "tái cược", "4bet", "4-bet", "raise lại", "cỡ 3bet", "bluff 3bet", "tố lại"],
    suggestionVi:
      "Tư vấn tham khảo: 3-bet để value + một ít bluff chọn lọc, cỡ theo vị trí; 4-bet thiên về tay cực mạnh. Định hướng chung, không ràng buộc.",
    playerWordingVi: "Định hướng chung: re-raise (3-bet) hợp lý với tay mạnh và một số tình huống chọn lọc, tùy vị trí và đối thủ.",
    citationLabel: "CHIẾN THUẬT",
    citationKind: "house",
    source: "house",
    category: "strategy",
  },
  {
    id: "strat-bankroll-variance",
    topicEn: "Bankroll & variance",
    topicVi: "Bankroll & phương sai (variance)",
    summaryEn:
      "Tournaments are high-variance: long downswings are normal even when playing well. Manage a bankroll that can absorb swings (many buy-ins) and pick buy-in levels you can sustain so variance never threatens your ability to keep playing.",
    summaryVi:
      "Giải đấu có phương sai cao: chuỗi thua dài là bình thường ngay cả khi chơi tốt. Quản lý bankroll đủ chịu biến động (nhiều buy-in) và chọn mức buy-in bền vững để phương sai không đe dọa khả năng tiếp tục chơi.",
    keywords: ["bankroll", "quản lý vốn", "variance", "phương sai", "downswing", "chuỗi thua", "quản lý buy-in", "vốn chơi giải", "rủi ro vốn", "số buy-in"],
    suggestionVi:
      "Tư vấn tham khảo: giữ bankroll nhiều buy-in, chọn mức buy-in bền vững, chấp nhận phương sai. Định hướng chung, không phải lời khuyên tài chính.",
    playerWordingVi: "Định hướng chung: giải đấu nhiều biến động, nên quản lý vốn đủ rộng để chuỗi thua không ảnh hưởng tới việc chơi lâu dài.",
    citationLabel: "CHIẾN THUẬT",
    citationKind: "house",
    source: "house",
    category: "strategy",
  },
];

/** Operations + floor procedure + strategy advisory entries (non-authoritative). */
export const ADVISORY_RULES: TdRule[] = [
  ...OPERATIONS_RULES,
  ...FLOOR_RULES,
  ...STRATEGY_RULES,
];
