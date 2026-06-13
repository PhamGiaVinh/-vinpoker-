import type { TdRule } from "./types";

// ⚠️ DEMO CORPUS — NOT AUTHORITATIVE.
// These are short, paraphrased, representative entries for the PR D UI shell
// only. They are NOT the official TDA 2024 text and the "#NN" labels are
// placeholders, not real TDA rule numbers. The sourced, versioned corpus with
// real provenance and citations arrives in PR E. Every rule is source:"demo".

export const MOCK_TD_RULES: TdRule[] = [
  {
    id: "string-bet",
    topicEn: "String bet",
    topicVi: "Đặt cược chuỗi (string bet)",
    summaryEn:
      "A bet/raise made in multiple forward motions without a prior verbal declaration is typically ruled a call or limited to the first motion.",
    summaryVi:
      "Cược/raise thực hiện thành nhiều lần đưa chip về phía trước mà không tuyên bố trước thường bị tính là call hoặc giới hạn ở lần đưa chip đầu.",
    keywords: ["string bet", "đặt cược chuỗi", "cược chuỗi", "string", "chuỗi chip", "raise nhiều lần"],
    suggestionVi:
      "Nếu không có tuyên bố miệng trước, cân nhắc tính là call hoặc giới hạn theo lần đưa chip đầu — TD xác nhận.",
    playerWordingVi:
      "Do anh/chị không tuyên bố mức cược trước và đưa chip thành nhiều lần, lần này em xin tính theo lần đưa chip đầu. Lần sau anh/chị nói rõ số tiền trước giúp em nhé.",
    citationLabel: "TDA placeholder #44",
    citationKind: "tda_placeholder",
    source: "demo",
  },
  {
    id: "action-out-of-turn",
    topicEn: "Action out of turn",
    topicVi: "Hành động sai lượt",
    summaryEn:
      "Action taken out of turn may be binding if the action to that player has not changed; otherwise it is typically not binding.",
    summaryVi:
      "Hành động sai lượt có thể bị ràng buộc nếu lượt đến người đó không thay đổi; nếu đã thay đổi thì thường không bị ràng buộc.",
    keywords: ["out of turn", "sai lượt", "hành động sai lượt", "không đúng lượt", "đặt cược sớm", "act early"],
    suggestionVi:
      "Kiểm tra xem hành động phía trước có thay đổi không; nếu không đổi có thể giữ ràng buộc — TD xác nhận.",
    playerWordingVi:
      "Anh/chị vừa hành động chưa tới lượt. Nếu các bạn phía trước không thay đổi, hành động này có thể được giữ; nếu thay đổi thì anh/chị được quyết định lại.",
    citationLabel: "TDA placeholder #38",
    citationKind: "tda_placeholder",
    source: "demo",
  },
  {
    id: "exposed-card",
    topicEn: "Exposed card",
    topicVi: "Bài bị lộ",
    summaryEn:
      "Accidentally exposed cards during the deal are handled per house procedure; a card exposed by a player is usually still live with possible penalty.",
    summaryVi:
      "Bài bị lộ trong lúc chia xử lý theo quy trình nhà; bài do người chơi tự làm lộ thường vẫn còn hiệu lực và có thể bị nhắc nhở/phạt.",
    keywords: ["exposed", "exposed card", "bài lộ", "lộ bài", "lật bài", "show bài"],
    suggestionVi:
      "Xác định ai làm lộ và thời điểm; bài người chơi tự lộ thường vẫn chơi tiếp — TD xác nhận theo luật CLB.",
    playerWordingVi:
      "Lá bài vừa bị lộ. Theo thông lệ, bài này vẫn được tính, mong anh/chị giữ bài kín hơn ở các ván sau.",
    citationLabel: "TDA placeholder #51",
    citationKind: "tda_placeholder",
    source: "demo",
  },
  {
    id: "verbal-declaration",
    topicEn: "Verbal declaration binding",
    topicVi: "Tuyên bố miệng có hiệu lực",
    summaryEn:
      "A clear verbal declaration of an action in turn is binding.",
    summaryVi:
      "Tuyên bố miệng rõ ràng đúng lượt thì có hiệu lực ràng buộc.",
    keywords: ["verbal", "tuyên bố", "nói miệng", "tuyên bố miệng", "declaration", "verbal declaration", "nói call", "nói raise"],
    suggestionVi:
      "Nếu tuyên bố rõ ràng và đúng lượt, giữ theo tuyên bố miệng — TD xác nhận.",
    playerWordingVi:
      "Anh/chị đã tuyên bố rõ hành động đúng lượt nên em xin giữ theo lời tuyên bố đó.",
    citationLabel: "TDA placeholder #47",
    citationKind: "tda_placeholder",
    source: "demo",
  },
  {
    id: "kill-winning-hand",
    topicEn: "Killing the winning hand",
    topicVi: "Hủy nhầm bài thắng",
    summaryEn:
      "A hand that is tabled face-up at showdown is entitled to the pot; mucked cards are usually dead even if they would have won.",
    summaryVi:
      "Bài đã lật ngửa trên bàn lúc showdown được quyền ăn pot; bài đã muck (bỏ) thường bị tính là chết dù có thể đã thắng.",
    keywords: ["kill", "muck", "hủy bài", "bỏ bài", "bài thắng", "killed hand", "winning hand", "muck bài thắng"],
    suggestionVi:
      "Xác định bài có được lật ngửa rõ ràng trên bàn không; nếu đã muck không phân biệt được thì thường tính chết — TD xác nhận.",
    playerWordingVi:
      "Bài cần được lật ngửa rõ trên bàn lúc showdown để được tính. Trường hợp đã bỏ vào chung mà không phân biệt được thì rất tiếc không thể tính thắng.",
    citationLabel: "TDA placeholder #16",
    citationKind: "tda_placeholder",
    source: "demo",
  },
  {
    id: "odd-chip",
    topicEn: "Odd chip in split pot",
    topicVi: "Chip lẻ khi chia đôi pot",
    summaryEn:
      "When a pot does not split evenly, the odd chip is awarded by a consistent house method (e.g., to the first seat left of the button).",
    summaryVi:
      "Khi pot không chia chẵn, chip lẻ được trao theo quy ước cố định của nhà (ví dụ ghế đầu tiên bên trái nút bài).",
    keywords: ["odd chip", "chip lẻ", "lẻ chip", "chia đôi pot", "split pot", "chia pot", "chip dư"],
    suggestionVi:
      "Áp dụng quy ước chip lẻ cố định của CLB (thường ghế trái nút bài) — TD xác nhận quy ước đang dùng.",
    playerWordingVi:
      "Pot chia đôi còn dư một chip, theo quy ước của CLB chip lẻ sẽ về ghế bên trái nút bài.",
    citationLabel: "TDA placeholder #25",
    citationKind: "tda_placeholder",
    source: "demo",
  },
  {
    id: "misdeal",
    topicEn: "Misdeal",
    topicVi: "Chia bài lỗi (misdeal)",
    summaryEn:
      "Defined dealing errors before significant action (e.g., wrong number of cards, exposed first/second card) are misdeals and the hand is redealt.",
    summaryVi:
      "Một số lỗi chia bài trước khi có hành động đáng kể (sai số lá, lộ lá đầu/lá hai) được tính là misdeal và chia lại.",
    keywords: ["misdeal", "chia bài lỗi", "chia lỗi", "lỗi chia bài", "redeal", "chia lại", "sai số lá"],
    suggestionVi:
      "Đối chiếu lỗi với danh mục misdeal của CLB và mức độ đã có hành động; nếu đủ điều kiện thì chia lại — TD xác nhận.",
    playerWordingVi:
      "Ván này có lỗi chia bài thuộc trường hợp chia lại, mong cả bàn thông cảm, dealer sẽ chia lại ngay.",
    citationLabel: "TDA placeholder #29",
    citationKind: "tda_placeholder",
    source: "demo",
  },
  {
    id: "all-in-side-pot",
    topicEn: "All-in and side pot",
    topicVi: "All-in và hũ phụ (side pot)",
    summaryEn:
      "When a player is all-in for less, a side pot is formed for the remaining bettors; the all-in player can only win the main pot.",
    summaryVi:
      "Khi một người all-in với số ít hơn, hũ phụ được lập cho những người còn cược; người all-in chỉ có thể ăn hũ chính.",
    keywords: ["all in", "all-in", "tố hết", "side pot", "hũ phụ", "pot phụ", "main pot", "hũ chính"],
    suggestionVi:
      "Tách hũ chính và hũ phụ theo số tiền all-in; người all-in chỉ tranh hũ chính — TD/đếm chip xác nhận.",
    playerWordingVi:
      "Vì có người all-in với số ít hơn nên mình tách hũ phụ. Người all-in chỉ tranh phần hũ chính tương ứng số tiền đã vào.",
    citationLabel: "TDA placeholder #33",
    citationKind: "tda_placeholder",
    source: "demo",
  },
  {
    id: "wrong-seat",
    topicEn: "Wrong seat / wrong player",
    topicVi: "Ngồi sai ghế",
    summaryEn:
      "If a player is in the wrong seat or a hand is dealt to the wrong position, handle per house procedure depending on how much action occurred.",
    summaryVi:
      "Nếu người chơi ngồi sai ghế hoặc bài chia sai vị trí, xử lý theo quy trình nhà tùy mức độ hành động đã diễn ra.",
    keywords: ["wrong seat", "sai ghế", "ngồi sai", "ghế sai", "sai vị trí", "đổi ghế"],
    suggestionVi:
      "Xác định mức độ hành động đã diễn ra trước khi phát hiện; xử lý theo quy trình CLB — TD xác nhận.",
    playerWordingVi:
      "Có vẻ anh/chị đang ngồi sai ghế. Em xin kiểm tra lại sơ đồ chỗ ngồi và điều chỉnh cho đúng.",
    citationLabel: "TDA placeholder #6",
    citationKind: "tda_placeholder",
    source: "demo",
  },
  {
    id: "premature-board-card",
    topicEn: "Premature board card",
    topicVi: "Lật bài chung sớm",
    summaryEn:
      "If a board card is exposed prematurely before betting completes, the dealer follows a defined procedure to remove/replace and reshuffle.",
    summaryVi:
      "Nếu lá bài chung bị lật sớm trước khi vòng cược xong, dealer theo quy trình thu hồi/thay thế và xáo lại đã định.",
    keywords: ["premature", "board card", "bài chung", "lật sớm", "flop sớm", "lật bài chung sớm", "turn sớm", "river sớm"],
    suggestionVi:
      "Tạm dừng, hoàn tất vòng cược đang dở rồi áp dụng quy trình thu hồi/thay lá theo luật — TD xác nhận.",
    playerWordingVi:
      "Lá bài chung vừa bị lật sớm. Mình sẽ hoàn tất vòng cược rồi xử lý lá bài theo đúng quy trình, mong cả bàn chờ một chút.",
    citationLabel: "TDA placeholder #40",
    citationKind: "tda_placeholder",
    source: "demo",
  },
  {
    id: "player-away",
    topicEn: "Player away from table",
    topicVi: "Khách rời bàn / vắng mặt",
    summaryEn:
      "A player not at their seat when it is their turn is typically folded after time; blinds/antes are still posted while away.",
    summaryVi:
      "Người chơi không có mặt tại ghế khi tới lượt thường bị bỏ bài sau thời gian quy định; vẫn phải đóng blind/ante khi vắng.",
    keywords: ["away", "rời bàn", "vắng mặt", "không có mặt", "absent", "rời ghế", "đi vệ sinh"],
    suggestionVi:
      "Cho đủ thời gian theo luật rồi xử lý fold nếu vẫn vắng; blind/ante vẫn tính — TD xác nhận.",
    playerWordingVi:
      "Tới lượt mà khách chưa có mặt, em xin chờ theo quy định rồi mới xử lý. Phần blind/ante vẫn được tính như bình thường.",
    citationLabel: "TDA placeholder #30",
    citationKind: "tda_placeholder",
    source: "demo",
  },
  {
    id: "unclear-raise",
    topicEn: "Unclear / ambiguous raise amount",
    topicVi: "Mức raise không rõ ràng",
    summaryEn:
      "When a raise amount is ambiguous, the raise is usually fixed at the maximum allowable that the wording/chips reasonably support, per house rule.",
    summaryVi:
      "Khi mức raise không rõ, thường chốt theo mức hợp lệ lớn nhất mà lời nói/chip hợp lý thể hiện, theo luật nhà.",
    keywords: ["unclear raise", "raise không rõ", "mức raise", "ambiguous", "mơ hồ", "không rõ raise", "raise mập mờ"],
    suggestionVi:
      "Làm rõ lại với người cược nếu kịp; nếu không, chốt theo quy ước mức hợp lệ của CLB — TD xác nhận.",
    playerWordingVi:
      "Mức raise vừa rồi chưa rõ, em xin xác nhận lại số tiền với anh/chị để cả bàn cùng rõ.",
    citationLabel: "TDA placeholder #45",
    citationKind: "tda_placeholder",
    source: "demo",
  },
];
