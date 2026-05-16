import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAgree: () => void;
}

const TOS_VI = `# ĐIỀU KHOẢN DỊCH VỤ VBacker

**Phiên bản:** 2.0  
**Nhà cung cấp:** VBacker (sau đây gọi là "VBacker", "Nền tảng", "chúng tôi")

## PHẦN 1. ĐỊNH NGHĨA VÀ PHẠM VI DỊCH VỤ

### Điều 1. Bản chất Nền tảng
VBacker là **phần mềm quản lý thông tin sự kiện tập huấn thể thao trí tuệ** (SaaS), cung cấp cho các Câu lạc bộ thể thao có giấy phép hoạt động hợp pháp.

VBacker **KHÔNG PHẢI LÀ**: dịch vụ tài chính/ngân hàng/ví điện tử; trung gian thanh toán; tổ chức cá cược/đánh bạc; sàn giao dịch chứng khoán/crypto; bên tham gia giao dịch tài chính giữa người dùng.

VBacker **CHỈ LÀ** công cụ kỹ thuật ghi nhận thông tin hỗ trợ chi phí tham gia sự kiện tập huấn, tính toán tỷ lệ chia sẻ kết quả theo thỏa thuận dân sự tự nguyện, và hỗ trợ CLB quản lý sự kiện.

### Điều 2. Định nghĩa
- **Player**: Cá nhân đăng ký tham gia sự kiện tập huấn, có nhu cầu tìm người hỗ trợ chi phí.
- **Backer**: Cá nhân tự nguyện hỗ trợ chi phí tham gia, đổi lại nhận tỷ lệ phần thưởng thành tích (nếu có).
- **CLB**: Tổ chức thể thao cơ sở có giấy phép hợp pháp, trực tiếp tổ chức sự kiện.
- **Lệ phí tập huấn**: Chi phí tham gia sự kiện do CLB quy định.
- **Phần thưởng thành tích**: Tiền/hiện vật Player nhận được từ CLB khi đạt thành tích.

## PHẦN 2. BẢN CHẤT PHÁP LÝ CỦA GIAO DỊCH

### Điều 3. Không phải chứng khoán, không phải đầu tư
Giao dịch giữa Player và Backer KHÔNG phải mua bán chứng khoán, không phải đầu tư doanh nghiệp. Không có cam kết lợi nhuận, không có bảo đảm hoàn vốn.

### Điều 4. Không phải cá cược, không phải đánh bạc
Backer không "đặt cược" vào kết quả; Backer **hỗ trợ chi phí** để Player tham gia tập huấn và hưởng phần thưởng theo thỏa thuận dân sự thống nhất trước.

### Điều 5. Không phải dịch vụ trung gian thanh toán
VBacker không mở/quản lý/nắm giữ tài khoản thanh toán/ví điện tử/escrow nào. Mọi chuyển tiền thực hiện **trực tiếp ngoài Nền tảng** qua chuyển khoản ngân hàng hoặc tiền mặt hợp pháp tại Việt Nam.

## PHẦN 3. QUY TRÌNH HOẠT ĐỘNG

### Điều 6. Vai trò của VBacker
Cung cấp giao diện tạo phiếu, hiển thị thông tin, tính toán tỷ lệ, ghi nhận trạng thái dựa trên xác nhận của các bên. **Không** nhận/giữ/chuyển tiền.

### Điều 7. Vai trò của CLB
CLB độc lập, tự chịu trách nhiệm về tổ chức sự kiện, trả phần thưởng, tuân thủ pháp luật thể thao. Cashier xác nhận trạng thái là trách nhiệm của CLB.

### Điều 8. Vai trò của Player và Backer
Hai bên độc lập tự nguyện. Backer tự đánh giá năng lực Player. Player báo cáo trung thực và thực hiện chia sẻ phần thưởng. Tranh chấp do hai bên tự giải quyết.

## PHẦN 4. PHÍ DỊCH VỤ

### Điều 9. Phí cố định
Khi check-in, Player có thể thanh toán Phí nền tảng cố định cho VBacker (qua CLB), tính theo phân khúc lệ phí tập huấn, công khai trên Nền tảng.

### Điều 10. Phí thành tích (1%)
Khi Player đạt phần thưởng, VBacker trích **1%** trên tổng phần thưởng trước khi 99% còn lại được chia theo tỷ lệ đã thỏa thuận.

### Điều 11. Cam kết phí
Phí công khai trước khi tạo phiếu. KHÔNG thu phí từ Backer dưới dạng "phí giao dịch" hay "hoa hồng".

## PHẦN 5. QUYỀN VÀ NGHĨA VỤ NGƯỜI DÙNG

### Điều 12. Điều kiện
Đủ 18 tuổi, năng lực hành vi dân sự đầy đủ, thông tin chính xác, tài khoản ngân hàng tại Việt Nam (với Backer).

### Điều 13. Nghĩa vụ
Tuân thủ pháp luật VN; chỉ dùng tại CLB hợp pháp; không tổ chức/tham gia đánh bạc/đa cấp/trái phép; **tuyệt đối không dùng crypto/tiền ảo**, mọi thanh toán bằng VND qua ngân hàng hoặc tiền mặt; tự chịu trách nhiệm về nguồn gốc tài sản.

### Điều 14. Cấm
Không bot/script thao túng; không tài khoản ảo gian lận; không lạm dụng thông tin người khác; không phát tán nội dung vi phạm.

### Điều 15. Khôi phục tài khoản và bảo mật
1. Người dùng có trách nhiệm tự bảo vệ thông tin đăng nhập (mật khẩu, email, thiết bị). VBacker không chịu trách nhiệm về tổn thất phát sinh từ việc người dùng để lộ mật khẩu, truy cập từ thiết bị không an toàn, hoặc bị đánh cắp tài khoản do lỗi chủ quan.
2. Trường hợp quên mật khẩu, người dùng có thể yêu cầu đặt lại mật khẩu qua email đã đăng ký. Liên kết đặt lại mật khẩu có hiệu lực trong thời hạn do hệ thống quy định (thông thường 60 phút) và chỉ gửi đến email chính chủ.
3. VBacker có quyền từ chối yêu cầu khôi phục tài khoản nếu người dùng không thể chứng minh quyền sở hữu email/SĐT đã đăng ký.
4. Người dùng cam kết không sử dụng tài khoản của người khác, không chia sẻ phiên đăng nhập (session), không sử dụng công cụ tự động để truy cập Nền tảng.

## PHẦN 6. SỞ HỮU TRÍ TUỆ VÀ DỮ LIỆU

### Điều 16. Sở hữu
Mã nguồn, giao diện, thuật toán, CSDL là tài sản của VBacker. Người dùng chỉ được dùng cho mục đích hợp pháp.

### Điều 17. Dữ liệu
Thu thập theo Chính sách Bảo mật. Không bán/cho thuê/chia sẻ dữ liệu cho bên thứ ba ngoài quy định pháp luật.

## PHẦN 7. MIỄN TRỪ TRÁCH NHIỆM

### Điều 18. Rủi ro
Hỗ trợ chi phí tiềm ẩn rủi ro mất một phần/toàn bộ. Không có cam kết về thứ hạng/phần thưởng. Backer tự nguyện chấp nhận rủi ro.

### Điều 19. Không phải tư vấn tài chính
Nền tảng không tư vấn tài chính/đầu tư/pháp lý/thuế. Số liệu lịch sử chỉ tham khảo.

### Điều 20. Giới hạn trách nhiệm VBacker
Không chịu trách nhiệm về: thiệt hại tài chính giữa các bên; tranh chấp tiền/tài sản/kết quả; vi phạm pháp luật của người dùng/CLB; sự cố kỹ thuật ngoài tầm kiểm soát.

### Điều 21. Trạng thái ghi nhận
Trạng thái "Đã nhận"/"Đã thanh toán" chỉ là **ghi chú nội bộ**, KHÔNG phải chứng từ thanh toán/biên lai. Các bên tự lưu chứng từ thực tế.

## PHẦN 8. HỖ TRỢ VÀ GIẢI QUYẾT KHIẾU NẠI

### Điều 22. Hỗ trợ và khiếu nại
1. VBacker cung cấp kênh hỗ trợ kỹ thuật và tiếp nhận phản ánh thông qua tài khoản hỗ trợ chính thức trên Nền tảng (chat) hoặc email support@vinpoker.com. Đây là kênh hỗ trợ về vận hành phần mềm, không phải kênh giải quyết tranh chấp tài chính giữa các bên.
2. Đối với tranh chấp phát sinh giữa Player và Backer (ví dụ: không đồng ý về kết quả thành tích, chậm thanh toán, vi phạm thỏa thuận), VBacker chỉ đóng vai trò **cung cấp thông tin ghi nhận** (audit log, ảnh chứng minh, lịch sử trạng thái) để các bên tự hòa giải. VBacker không có thẩm quyền phán xét, không bắt buộc bất kỳ bên nào thực hiện nghĩa vụ tài chính.
3. Người dùng có thể gửi khiếu nại về lỗi kỹ thuật của Nền tảng (ví dụ: tính toán sai số liệu, không hiển thị thông tin). VBacker sẽ kiểm tra và khắc phục trong thời hạn hợp lý (tối đa 07 ngày làm việc).
4. Nếu phát hiện hành vi gian lận, sử dụng tài khoản ảo, hoặc lạm dụng Nền tảng, VBacker có quyền đình chỉ tài khoản, xóa nội dung vi phạm và từ chối cung cấp dịch vụ mà không cần thông báo trước.
5. Mọi yêu cầu bồi thường thiệt hại đối với VBacker chỉ được chấp nhận nếu thiệt hại đó được chứng minh là do lỗi cố ý hoặc sơ suất nghiêm trọng của VBacker trong việc vận hành phần mềm. VBacker không bồi thường các thiệt hại gián tiếp, thiệt hại do quyết định đầu tư/hỗ trợ chi phí của người dùng.

## PHẦN 9. TRANH CHẤP VÀ CHẤM DỨT

### Điều 23. Giải quyết tranh chấp
Ưu tiên thương lượng; nếu không được, giải quyết tại Tòa án nhân dân có thẩm quyền tại Việt Nam.

### Điều 24. Chấm dứt
VBacker có quyền đình chỉ tài khoản vi phạm. Người dùng có quyền ngừng dùng bất cứ lúc nào. Nghĩa vụ phát sinh trước đó vẫn còn hiệu lực.

## PHẦN 10. ĐIỀU KHOẢN CHUNG

### Điều 25. Luật áp dụng — Pháp luật Việt Nam.
### Điều 26. Thay đổi — Thông báo trên Nền tảng trước khi có hiệu lực.
### Điều 27. Liên hệ — legal@vinpoker.com

---

# CHÍNH SÁCH BẢO MẬT THÔNG TIN CÁ NHÂN

**Căn cứ:** Luật An ninh mạng 2018, Nghị định 13/2023/NĐ-CP, Bộ luật Dân sự 2015.

## Điều 1. Nguyên tắc
Tôn trọng quyền riêng tư, bảo vệ dữ liệu cá nhân. Chỉ thu thập/xử lý khi có sự đồng ý.

## Điều 2. Định nghĩa
- **Dữ liệu cá nhân**: thông tin gắn với cá nhân cụ thể.
- **Dữ liệu nhạy cảm**: thông tin tài khoản ngân hàng, vị trí, sinh trắc.

## Điều 3. Phạm vi thu thập
- Cơ bản: họ tên, SĐT, email, tên hiển thị.
- Nhận dạng: avatar, tài khoản ngân hàng, user_id.
- Hoạt động: phiếu deal, lịch sử trạng thái, ảnh chứng minh/biên lai (tự nguyện), đánh giá.
- Kỹ thuật: IP, thiết bị, OS, trình duyệt, cookie, log.

## Điều 4. Mục đích
Cung cấp dịch vụ; xác thực; liên lạc; hỗ trợ; tuân thủ pháp luật; cải thiện. **Không** dùng cho quảng cáo bên thứ ba nếu không có đồng ý rõ ràng.

## Điều 5. Cơ sở pháp lý
Sự đồng ý; thực hiện hợp đồng; nghĩa vụ pháp lý.

## Điều 6. Thời gian lưu trữ
- 03 năm với dữ liệu giao dịch.
- 01 năm với log đăng nhập.
- Hết hạn: xóa hoặc ẩn danh hóa.

## Điều 7. Chia sẻ dữ liệu
KHÔNG bán/cho thuê. Chỉ chia sẻ với CLB, người dùng khác (thông tin công khai), nhà cung cấp kỹ thuật, hoặc theo yêu cầu pháp luật.

## Điều 8. Bảo mật
SSL/TLS, mã hóa cột nhạy cảm, RLS, MFA quản trị, sao lưu, giới hạn truy cập.

## Điều 9. Cookie
Đăng nhập, ngôn ngữ, analytics. Có thể tắt nhưng có thể ảnh hưởng tính năng.

## Điều 10. Quyền của chủ thể dữ liệu
Theo NĐ 13/2023/NĐ-CP. Liên hệ qua privacy@vinpoker.com — phản hồi trong 72h làm việc.

## Điều 11. Rút lại sự đồng ý
Có quyền rút lại bất cứ lúc nào.

## Điều 12. Trách nhiệm người dùng
Cung cấp thông tin chính xác; bảo mật mật khẩu; báo ngay nếu phát hiện truy cập trái phép.

## Điều 13. Thay đổi
Thông báo trước ít nhất 7 ngày.

## Điều 14. Liên hệ
- Email: privacy@vinpoker.com

---

**BẰNG VIỆC NHẤN "TÔI ĐỒNG Ý", BẠN XÁC NHẬN ĐÃ ĐỌC, HIỂU VÀ ĐỒNG Ý VỚI TOÀN BỘ ĐIỀU KHOẢN DỊCH VỤ VÀ CHÍNH SÁCH BẢO MẬT TRÊN.**
`;

const TOS_EN = `# VBacker TERMS OF SERVICE

**Version:** 2.0  
**Provider:** VBacker (hereinafter "VBacker", the "Platform", "we")

## PART 1. DEFINITIONS AND SCOPE

### Article 1. Nature of the Platform
VBacker is **SaaS software for managing intellectual sports training events**, provided to legally licensed sports clubs.

VBacker is **NOT**: a financial/banking/e-wallet service; a payment intermediary; a betting/gambling operator; a securities/crypto exchange; or a party to financial transactions between users.

VBacker is **ONLY** a technical tool that records cost-support information for training events, calculates result-sharing ratios under voluntary civil agreements, and helps clubs manage events.

### Article 2. Definitions
- **Player**: Individual registering for a training event who needs cost support.
- **Backer**: Individual who voluntarily supports the cost in exchange for a share of any reward.
- **Club**: Legally licensed grassroots sports organization that directly runs the event.
- **Training fee**: Participation cost set by the club.
- **Performance reward**: Money/items the player receives from the club for results achieved.

## PART 2. LEGAL NATURE OF TRANSACTIONS

### Article 3. Not securities, not investment
Transactions between Player and Backer are NOT securities trading or business investment. No profit guarantee, no capital guarantee.

### Article 4. Not betting, not gambling
The Backer does not "wager" on outcomes; the Backer **supports the cost** for the Player to attend training and receives a reward share under a pre-agreed civil arrangement.

### Article 5. Not a payment intermediary
VBacker does not open/manage/hold any payment account, e-wallet, or escrow. All money transfers happen **off-platform** via legal Vietnamese bank transfer or cash.

## PART 3. OPERATING PROCESS

### Article 6. VBacker's role
Provide UI for creating tickets, displaying info, computing ratios, and recording status based on party confirmations. We do **not** receive/hold/transfer money.

### Article 7. Club's role
The Club is independent and responsible for organizing events, paying rewards, and complying with sports law. Cashier confirmations are the Club's responsibility.

### Article 8. Player and Backer roles
Both parties act independently and voluntarily. The Backer assesses the Player's ability. The Player reports honestly and shares rewards. Disputes are resolved between the parties.

## PART 4. SERVICE FEES

### Article 9. Fixed fee
At check-in, the Player may pay a fixed Platform fee to VBacker (via the Club), tiered by training fee bracket and disclosed publicly.

### Article 10. Performance fee (1%)
When the Player wins a reward, VBacker takes **1%** of the gross reward before the remaining 99% is split per the agreed ratio.

### Article 11. Fee commitment
Fees are disclosed before ticket creation. We do NOT charge Backers any "transaction fee" or "commission".

## PART 5. USER RIGHTS AND OBLIGATIONS

### Article 12. Eligibility
At least 18 years old, full civil capacity, accurate information, Vietnamese bank account (for Backers).

### Article 13. Obligations
Comply with Vietnamese law; only use at licensed clubs; do not organize/participate in gambling/MLM/illegal activity; **never use crypto/virtual currency** — all payments in VND via bank or cash; you are responsible for the source of your assets.

### Article 14. Prohibitions
No bots/scripts; no fake accounts; no abuse of others' info; no distribution of infringing content.

### Article 15. Account recovery and security
1. Users are responsible for protecting their own login credentials (password, email, devices). VBacker is not liable for losses arising from disclosed passwords, access from unsafe devices, or account theft caused by user negligence.
2. If you forget your password, you may request a password reset via your registered email. The reset link is valid for the period set by the system (typically 60 minutes) and is sent only to the registered email owner.
3. VBacker reserves the right to refuse a recovery request if the user cannot prove ownership of the registered email/phone.
4. Users commit not to use other people's accounts, not to share login sessions, and not to use automated tools to access the Platform.

## PART 6. INTELLECTUAL PROPERTY AND DATA

### Article 16. Ownership
Source code, UI, algorithms, and database belong to VBacker. Users may only use them lawfully.

### Article 17. Data
Collected per the Privacy Policy. We do not sell/lease/share data outside the law.

## PART 7. DISCLAIMERS

### Article 18. Risk
Cost support carries risk of partial/total loss. No commitment about ranking/reward. Backers accept risk voluntarily.

### Article 19. Not financial advice
The Platform does not provide financial/investment/legal/tax advice. Historical figures are for reference only.

### Article 20. Limitation of liability
We are not responsible for: financial loss between parties; disputes over money/assets/results; user/club legal violations; technical incidents beyond our control.

### Article 21. Recorded status
"Received" / "Paid" status is **internal note only**, NOT a payment receipt. Parties keep their own real records.

## PART 8. SUPPORT AND COMPLAINT RESOLUTION

### Article 22. Support and complaints
1. VBacker provides technical support and feedback channels via the official support account on the Platform (chat) or email support@vinpoker.com. These are software-operations support channels, not channels for resolving financial disputes between parties.
2. For disputes between Player and Backer (e.g., disagreements about results, late payments, breach of agreement), VBacker only acts to **provide recorded information** (audit logs, proof images, status history) for the parties to settle on their own. VBacker has no adjudication authority and does not compel any party to perform financial obligations.
3. Users may submit complaints about Platform technical errors (e.g., incorrect calculations, missing information). VBacker will review and remediate within a reasonable time (up to 7 working days).
4. If fraud, fake accounts or platform abuse is detected, VBacker may suspend the account, remove infringing content and refuse service without prior notice.
5. Compensation claims against VBacker will only be accepted if the damages are proven to result from VBacker's intentional fault or gross negligence in operating the software. VBacker does not compensate indirect damages or damages from users' investment/cost-support decisions.

## PART 9. DISPUTES AND TERMINATION

### Article 23. Dispute resolution
Negotiation first; otherwise, the competent Vietnamese People's Court.

### Article 24. Termination
We may suspend violating accounts. Users may stop using the service at any time. Pre-existing obligations remain in force.

## PART 10. GENERAL

### Article 25. Governing law — Vietnamese law.
### Article 26. Changes — Notice on the Platform before taking effect.
### Article 27. Contact — legal@vinpoker.com

---

# PRIVACY POLICY

**Basis:** Cybersecurity Law 2018, Decree 13/2023/NĐ-CP, Civil Code 2015.

## Article 1. Principles
Respect for privacy; protection of personal data. Collected/processed only with consent.

## Article 2. Definitions
- **Personal data**: information tied to a specific individual.
- **Sensitive data**: bank account info, location, biometrics.

## Article 3. Scope of collection
- Basic: name, phone, email, display name.
- Identification: avatar, bank account, user_id.
- Activity: deal tickets, status history, voluntary proof images, ratings.
- Technical: IP, device, OS, browser, cookies, logs.

## Article 4. Purpose
Provide service; verify identity; communicate; support; comply with law; improve service. **Not** for third-party advertising without explicit consent.

## Article 5. Legal basis
Consent; contract performance; legal obligation.

## Article 6. Retention
- 3 years for transaction data.
- 1 year for login logs.
- After expiry: deleted or anonymized.

## Article 7. Data sharing
We do NOT sell/lease data. Shared only with: Clubs (identity confirmation), other users (public info), technical providers, or as required by law.

## Article 8. Security
SSL/TLS, sensitive-column encryption, RLS, admin MFA, backups, restricted internal access.

## Article 9. Cookies
Login persistence, language preference, analytics. May be disabled but features may be affected.

## Article 10. Data subject rights
Per Decree 13/2023/NĐ-CP. Contact privacy@vinpoker.com — response within 72 working hours.

## Article 11. Withdraw consent
You may withdraw consent at any time.

## Article 12. User responsibility
Provide accurate info; protect your password; report any unauthorized access.

## Article 13. Changes
At least 7 days' notice before taking effect.

## Article 14. Contact
- Email: privacy@vinpoker.com

---

**BY CLICKING "I AGREE", YOU CONFIRM YOU HAVE READ, UNDERSTOOD AND AGREE TO ALL OF THE ABOVE TERMS OF SERVICE AND PRIVACY POLICY.**
`;

const TOS_ZH = `# VBacker 服务条款

**版本:** 2.0  
**提供方:** VBacker (以下简称 "VBacker"、"平台"、"我们")

## 第一部分 定义与服务范围

### 第1条 平台性质
VBacker 是面向已合法持牌的体育俱乐部提供的**智力体育训练赛事信息管理 SaaS 软件**。

VBacker **不是**: 金融/银行/电子钱包服务; 支付中介; 博彩/赌博机构; 证券/加密货币交易所; 也不是用户之间金融交易的当事方。

VBacker **仅是**记录训练赛事费用支持信息、按自愿民事约定计算结果分享比例、并协助俱乐部管理赛事的技术工具。

### 第2条 定义
- **Player(选手)**: 报名参加训练赛事并需要费用支持的个人。
- **Backer(支持者)**: 自愿支持费用以换取成绩奖励分成的个人。
- **俱乐部**: 直接组织赛事的合法持牌基层体育组织。
- **训练费**: 俱乐部规定的参赛费用。
- **成绩奖励**: 选手依成绩从俱乐部获得的现金/实物。

## 第二部分 交易的法律性质

### 第3条 非证券、非投资
Player 与 Backer 之间的交易**不是**证券买卖,也不是企业投资。无利润承诺,无本金保障。

### 第4条 非博彩、非赌博
Backer 不是对结果"下注";Backer 是**支持费用**,让 Player 参加训练并依据事先约定的民事协议获得奖励分成。

### 第5条 非支付中介
VBacker 不开设/管理/持有任何支付账户、电子钱包或托管账户。所有资金转移均**在平台之外**通过越南合法的银行转账或现金完成。

## 第三部分 运作流程

### 第6条 VBacker 的角色
提供建单界面、信息展示、比例计算,并根据各方确认记录状态。**不**接收/保管/转移资金。

### 第7条 俱乐部的角色
俱乐部独立运营,自行负责赛事组织、奖励发放及遵守体育法律。出纳确认状态由俱乐部负责。

### 第8条 Player 与 Backer 的角色
双方独立自愿。Backer 自行评估 Player 的能力。Player 应如实报告并按约定分享奖励。争议由双方自行解决。

## 第四部分 服务费

### 第9条 固定费用
签到时,Player 可向 VBacker(经俱乐部)缴纳固定的平台费,按训练费分档收取并公开披露。

### 第10条 成绩费 (1%)
Player 取得奖励时,VBacker 在按约定比例分配剩余 99% 之前,先抽取奖励总额的 **1%**。

### 第11条 收费承诺
费用在建单前公开。**不**向 Backer 收取任何"交易费"或"佣金"。

## 第五部分 用户权利与义务

### 第12条 资格
年满 18 周岁,完全民事行为能力,信息真实;Backer 须有越南境内银行账户。

### 第13条 义务
遵守越南法律;仅在合法俱乐部使用;不得组织/参与赌博/传销/非法活动;**严禁使用加密货币/虚拟货币**,所有支付以越南盾通过银行或现金进行;自行承担资产来源的责任。

### 第14条 禁止
不得使用机器人/脚本;不得使用虚假账户欺诈;不得滥用他人信息;不得传播侵权内容。

### 第15条 账户恢复与安全
1. 用户应自行妥善保管登录凭证(密码、邮箱、设备)。因密码泄露、在不安全设备登录或主观过失导致账户被盗所产生的损失,VBacker 不承担责任。
2. 忘记密码时,用户可通过注册邮箱申请重置密码。重置链接的有效期由系统规定(通常为 60 分钟),且仅发送至本人注册邮箱。
3. 若用户无法证明对注册邮箱/手机号的所有权,VBacker 有权拒绝账户恢复请求。
4. 用户承诺不使用他人账户,不共享登录会话(session),不使用自动化工具访问平台。

## 第六部分 知识产权与数据

### 第16条 所有权
源代码、界面、算法、数据库归 VBacker 所有。用户仅可合法使用。

### 第17条 数据
按《隐私政策》收集。除法律规定外,不出售/出租/共享数据。

## 第七部分 免责声明

### 第18条 风险
费用支持存在部分/全部损失风险。无名次/奖励的承诺。Backer 自愿承担风险。

### 第19条 非财务建议
平台不提供财务/投资/法律/税务咨询。历史数据仅供参考。

### 第20条 责任限制
我们不对以下事项负责:各方之间的财务损失;关于资金/资产/结果的争议;用户/俱乐部的违法行为;不可抗力的技术事故。

### 第21条 状态记录
"已收"/"已付款"状态仅为**内部备注**,不是付款凭证。各方应自行保留实际凭证。

## 第八部分 支持与投诉处理

### 第22条 支持与投诉
1. VBacker 通过平台上的官方支持账户(聊天)或邮箱 support@vinpoker.com 提供技术支持与反馈接收渠道。这是软件运营支持渠道,不是各方之间财务争议的处理渠道。
2. 对于 Player 与 Backer 之间的争议(例如对成绩结果有异议、付款延迟、违反约定),VBacker 仅**提供留存信息**(审计日志、凭证图片、状态历史),供双方自行协商解决。VBacker 无裁决权,亦不强制任何一方履行财务义务。
3. 用户可就平台技术故障(例如计算错误、信息显示异常)提交投诉。VBacker 将在合理期限内核查并处理(最长 7 个工作日)。
4. 如发现欺诈、虚假账户或滥用平台行为,VBacker 有权暂停账户、删除违规内容并拒绝提供服务,无需事先通知。
5. 仅在能够证明损害是由 VBacker 在软件运营中故意或重大过失造成的情况下,方可受理对 VBacker 的赔偿请求。VBacker 不对间接损失,以及用户的投资/费用支持决策所致的损失承担赔偿责任。

## 第九部分 争议与终止

### 第23条 争议解决
优先协商;协商不成的,由越南有管辖权的人民法院解决。

### 第24条 终止
我们有权暂停违规账户。用户可随时停止使用。此前产生的义务继续有效。

## 第十部分 一般条款

### 第25条 适用法律 — 越南法律。
### 第26条 变更 — 在生效前于平台公告。
### 第27条 联系方式 — legal@vinpoker.com

---

# 个人信息隐私政策

**依据:** 2018 网络安全法、第 13/2023/NĐ-CP 号法令、2015 民法典。

## 第1条 原则
尊重隐私,保护个人数据;仅在获得同意后收集/处理。

## 第2条 定义
- **个人数据**: 与特定个人相关的信息。
- **敏感数据**: 银行账户信息、位置、生物特征。

## 第3条 收集范围
- 基本: 姓名、电话、邮箱、显示名。
- 识别: 头像、银行账户、user_id。
- 活动: 协议单、状态历史、自愿提交的凭证图片、评价。
- 技术: IP、设备、操作系统、浏览器、Cookie、日志。

## 第4条 目的
提供服务;身份验证;沟通通知;客户支持;合规;改进服务。未经明确同意,**不**用于第三方广告。

## 第5条 法律依据
用户同意;履行合同;法律义务。

## 第6条 保留期限
- 交易数据 3 年。
- 登录日志 1 年。
- 到期后删除或匿名化。

## 第7条 数据共享
**不出售/出租**数据。仅与以下方共享:俱乐部(身份确认)、其他用户(公开信息)、技术服务商,或依法律要求。

## 第8条 安全
SSL/TLS、敏感字段加密、RLS、管理员 MFA、备份、内部访问限制。

## 第9条 Cookie
保持登录、语言偏好、分析。可关闭,但可能影响功能。

## 第10条 数据主体权利
依第 13/2023/NĐ-CP 号法令。请通过 privacy@vinpoker.com 联系 — 在 72 个工作小时内回复。

## 第11条 撤回同意
您可随时撤回同意。

## 第12条 用户责任
提供准确信息;保管密码;发现未授权访问应立即报告。

## 第13条 变更
在生效前至少 7 天通知。

## 第14条 联系方式
- 邮箱: privacy@vinpoker.com

---

**点击"我同意"即表示您已阅读、理解并同意以上全部服务条款与隐私政策。**
`;

export const TosAgreementModal = ({ open, onOpenChange, onAgree }: Props) => {
  const { t, i18n } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [reachedBottom, setReachedBottom] = useState(false);

  const lang = i18n.language?.startsWith("zh") ? "zh" : i18n.language?.startsWith("en") ? "en" : "vi";
  const TOS_MD = lang === "en" ? TOS_EN : lang === "zh" ? TOS_ZH : TOS_VI;
  const titleText = lang === "en"
    ? "VBacker Terms of Service & Privacy Policy"
    : lang === "zh"
      ? "VBacker 服务条款与隐私政策"
      : "Điều khoản Dịch vụ & Chính sách Bảo mật VBacker";
  const closeText = lang === "en" ? "Close" : lang === "zh" ? "关闭" : "Đóng";
  const agreeText = lang === "en" ? "I agree" : lang === "zh" ? "我同意" : "Tôi đồng ý";
  const readMoreText = lang === "en"
    ? "Please read to the end"
    : lang === "zh"
      ? "请阅读到底"
      : "Vui lòng đọc đến cuối";

  useEffect(() => {
    if (open) {
      setProgress(0);
      setReachedBottom(false);
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      });
    }
  }, [open, lang]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const max = Math.max(1, scrollHeight - clientHeight);
    const pct = Math.min(100, Math.round((scrollTop / max) * 100));
    setProgress(pct);
    if (scrollTop + clientHeight >= scrollHeight - 50) setReachedBottom(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[95vw] h-[85vh] sm:h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b">
          <DialogTitle className="text-base sm:text-lg">{titleText}</DialogTitle>
          <div className="flex items-center gap-2 mt-2">
            <Progress value={progress} className="h-1.5 flex-1" />
            <span className="text-[11px] text-muted-foreground tabular-nums w-10 text-right">{progress}%</span>
          </div>
        </DialogHeader>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 text-[13px] sm:text-sm leading-relaxed whitespace-pre-wrap text-foreground/90"
        >
          {TOS_MD}
          <div className="h-4" />
        </div>

        <DialogFooter className="p-3 border-t gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{closeText}</Button>
          <Button
            disabled={!reachedBottom}
            onClick={() => { onAgree(); onOpenChange(false); }}
            className="gradient-gold text-primary-foreground border-0 disabled:opacity-50"
          >
            {reachedBottom ? agreeText : readMoreText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TosAgreementModal;
