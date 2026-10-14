# ProfileVault — PRD

**Phiên bản:** 1.3 · **Ngày:** 14/10/2026 · **Tác giả:** Tan · **Kiến trúc tham chiếu:** `profilevault-agent-architecture.md` v1.2

Các giá trị chưa có dữ liệu thực tế được đánh dấu **[giả định]** và liệt kê ở mục 14.

---

## 1. Bối cảnh và vấn đề

Tác giả vận hành nhiều kênh YouTube, mỗi kênh một email riêng. Khâu upload làm tay và lặp lại; tự động hóa có thể tiết kiệm nhiều giờ mỗi tuần, nhưng nếu nền tảng nhận ra nhiều kênh có chung dấu hiệu hoặc phát hiện tự động hóa, rủi ro là mất kênh.

Fury Antidetect Browser (mã nguồn mở) cho mỗi kênh một định danh trình duyệt riêng. Chưa có cách nào để: (a) **đo** xem định danh đó có thật sự ổn định và không bị phát hiện trong thời gian dài, (b) **mở dần** tự động hóa cho từng kênh dựa trên số đo đó, và (c) cho app khác đẩy việc vào khi đã được phép.

**Vấn đề cần giải:** *Đưa từng kênh từ upload tay sang upload tự động một cách có bằng chứng, dừng ngay khi có dấu hiệu rủi ro, và để app sản xuất video dùng được khi kênh đã sẵn sàng.*

---

## 2. Mục tiêu

| Mục tiêu | Chỉ số sau 3 tháng |
|---|---|
| Quyết định dựa trên số đo | Mọi lần lên mức đều có số liệu trên dashboard đạt ngưỡng và được người vận hành xác nhận |
| An toàn tài khoản | 0 kênh bị khóa/cảnh báo liên quan tự động hóa; mọi dấu hiệu đỏ được ghi nhận và hạ mức trong ≤ 1 giờ kể từ khi xuất hiện (hệ thống phản ứng ≤ 1 phút sau khi ghi nhận — mục 11) |
| Giảm thao tác tay | Kênh ở mức Tự động: ≥ 90% job hoàn tất không cần người |
| Mở rộng rẻ | Thêm flow mới ≤ 1 ngày công với Claude Code; sửa flow khi giao diện đổi ≤ 2 giờ |
| App khác dùng được | App sản xuất video gửi job và nhận `video_id` cho kênh đã ở mức cho phép |

**Không phải mục tiêu:** thay thế Fury; tự đăng công khai; tăng tương tác; tạo tài khoản; chạy cloud; đa người dùng ở M0–M2.

---

## 3. Người dùng

| Vai | Mô tả | Cách dùng |
|---|---|---|
| **Người vận hành** (tác giả) | 5–10 kênh, mỗi kênh một email và một profile Fury; quen terminal và Claude Code | Fury desktop (thao tác tay), dashboard localhost, Claude Code |
| **App sản xuất video** | Pipeline trên cùng máy | Integration API, chỉ với kênh ở mức Bán tự động trở lên |
| **VA** [giả định: ngoài M0–M2] | Hỗ trợ kênh được giao | Fury team mode (M3) |

---

## 4. Mức tự động hóa theo profile

Mỗi binding (kênh ↔ profile) có một mức. Hệ thống **không bao giờ** chạy thứ vượt quá mức của binding.

| Mức | Hệ thống được làm | Người vận hành làm | CDP |
|---|---|---|---|
| **L0 Thủ công** | Kiểm tra proxy ngoài trình duyệt (qua Fury); kiểm tra độ nhất quán các lớp không cần trình duyệt; ghi nhận sự kiện và file probe người vận hành nhập | Tự mở profile, tự upload, khai báo sự kiện, chạy probe tay | Không bao giờ |
| **L1 Quan sát** | Thêm `session-check` tự động, chỉ đọc (mở Studio, xác nhận đăng nhập, đóng) theo lịch; từ M1 thêm `probe` tự động | Vẫn upload tay | Chỉ trong lúc kiểm tra |
| **L2 Bán tự động** | Flow upload điền file + metadata, **dừng trước nút cuối** | Xem lại và bấm | Chỉ trong lúc điền |
| **L3 Tự động** | Flow upload chạy hết, để riêng tư; chỉ dừng khi cần người | Đặt công khai trong Studio | Chỉ trong lúc chạy |

**Lên mức:** dashboard báo "đạt ngưỡng" → người vận hành bấm xác nhận. Không tự lên.

**Ngưỡng lên mức [giả định, cấu hình được]:**

| Chuyển | Điều kiện trong cửa sổ quan sát |
|---|---|
| L0 → L1 | ≥ 14 ngày ở L0; ≥ 5 upload tay đã khai báo; 0 yêu cầu xác minh/CAPTCHA/cảnh báo; exit proxy giữ nguyên quốc gia + ASN; detect-suite của Fury xanh trên phiên bản Fury hiện tại; **kiểm tra độ nhất quán không có luật *chặn* nào trượt, checklist tài khoản đã hoàn tất** |
| L1 → L2 | ≥ 14 ngày ở L1; `session-check` thành công ≥ 95%; 0 lần đăng xuất bất thường; các điều kiện L0 vẫn đúng |
| L2 → L3 | ≥ 30 ngày ở L2; ≥ 20 upload bán tự động; tỉ lệ flow điền đúng ≥ 95%; 0 yêu cầu xác minh/cảnh báo; không có `SITE_CHANGED` chưa xử lý |

**Hạ mức tự động (ngay lập tức, tạm dừng job của binding):**

| Dấu hiệu | Hành động |
|---|---|
| Yêu cầu xác minh tài khoản, CAPTCHA, cảnh báo từ nền tảng, đăng xuất bất thường | Về **L0**, dừng mọi job, toast đỏ |
| Exit proxy đổi quốc gia hoặc ASN (luật lớp E, mục 5.1) | Hạ **một mức**, dừng job tới khi người vận hành xác nhận |
| Detect-suite đỏ sau khi nâng Fury | Giữ mức nhưng dừng job tới khi xanh lại |
| Luật nhất quán mức *chặn* trượt (mục 5), trừ hai trường hợp dưới | Giữ mức nhưng dừng job tới khi sửa xong và kiểm lại xanh |
| Hai binding trùng exit IP | Về **L0** cả hai binding, dừng job |
| `SITE_CHANGED` 2 lần liên tiếp | Hạ một mức (L3→L2) tới khi flow được sửa |

Hạ mức reset bộ đếm cửa sổ quan sát của mức đó.

---

## 5. Kiểm tra độ nhất quán profile

**Mục đích.** Một profile phải trông như *một người thật, trên một máy thật, ở một nơi thật*, ổn định qua thời gian. Fury lo phần bên trong trình duyệt (persona chụp từ máy thật, giá trị đồng nhất giữa trang/Worker/iframe, nhiễu tất định). ProfileVault kiểm phần còn lại: profile có khớp với mạng, máy chạy, tài khoản, các profile khác và chính nó theo thời gian hay không.

### 5.1 Năm lớp luật

Mỗi luật có mức **chặn** (không rời L0, dừng job ở mức cao hơn) hoặc **cảnh báo** (hiện trên dashboard, không chặn). Danh sách dưới là bộ luật khởi đầu; ngưỡng và mức chỉnh được.

| Lớp | Luật | Mức |
|---|---|---|
| **A. Profile ↔ mạng** | Quốc gia exit proxy = quốc gia khai cho kênh (thị trường) | Chặn |
| | Múi giờ trình duyệt khớp vị trí exit proxy | Chặn |
| | Ngôn ngữ trình duyệt (Accept-Language, `navigator.languages`) hợp lý với quốc gia exit (ngôn ngữ chính của nước đó hoặc tiếng Anh) | Cảnh báo |
| | Geolocation: tắt hoặc khớp vị trí exit | Chặn |
| | ASN exit thuộc loại ISP/residential; datacenter/hosting | Chặn |
| | Không rò WebRTC, DNS đi qua proxy (từ kết quả probe) | Chặn |
| **B. Profile ↔ máy chạy** | OS persona = OS máy chạy (Windows) | Chặn |
| | Hạng GPU persona hợp lý so với GPU thật (không khai GPU yếu hơn nhiều khi render nhanh bất thường, và ngược lại) | Cảnh báo |
| | Độ phân giải persona ≤ màn hình thật; cửa sổ mở khớp kích thước khai | Cảnh báo |
| | Danh sách voices/font không lộ hệ điều hành khác | Chặn |
| **C. Profile ↔ tài khoản** | Thị trường kênh ↔ quốc gia proxy ↔ vùng tài khoản Google ↔ quốc gia kênh YouTube | Chặn nếu lệch quốc gia; cảnh báo nếu chưa khai |
| | Ngôn ngữ giao diện YouTube Studio = cấu hình pack (English) — **chấp nhận có chủ đích** dù khác ngôn ngữ trình duyệt | Thông tin |
| | Checklist tài khoản đã hoàn tất (mục 5.3) | Chặn rời L0 |
| **D. Giữa các profile** | Không hai binding chung exit IP | Chặn |
| | Không hai binding chung dải /24 (IPv4) hoặc /48 (IPv6) | Cảnh báo |
| | Không hai profile trùng cặp persona + seed | Chặn |
| | Không quá **[giả định] 3** profile cùng persona trên cùng ASN | Cảnh báo |
| | Email khôi phục và số điện thoại khôi phục không trùng giữa các kênh (khai trong checklist) | Chặn |
| **E. Theo thời gian** | Exit proxy giữ quốc gia + ASN so với lần trước | Chặn; khi trượt áp dòng "Exit proxy đổi quốc gia hoặc ASN" ở mục 4 (hạ một mức) |
| | Hash canvas/WebGL/audio từ probe giữ nguyên giữa hai lần đo cùng phiên bản Fury | Chặn |
| | Sau khi nâng Fury: chỉ phiên bản trình duyệt/UA đổi; các giá trị khác giữ nguyên | Chặn |
| | Không đổi persona của profile đang có binding | Chặn |

### 5.2 Nguồn dữ liệu

| Dữ liệu | Lấy từ | Có mở trình duyệt? |
|---|---|---|
| Cấu hình persona, proxy, múi giờ, ngôn ngữ của profile | Fury (API hoặc file profile — xác minh ở spike) | Không |
| Exit IP, quốc gia, thành phố, ASN, loại ASN | Kiểm proxy qua Fury | Không |
| Giá trị thực tế trong trình duyệt (UA, GPU, màn hình, voices, fonts, WebRTC, DNS, hash nhiễu) | **Probe của Fury**: người vận hành mở trang probe trong profile, xuất file kết quả, nhập vào ProfileVault. Từ M1, binding ≥ L1 chạy tự động qua flow `generic/probe` | L0 (và L1 ở M0): người mở tay · L1+ từ M1: flow |
| Thông tin máy chạy (OS, GPU, màn hình) | ProfileVault tự đọc trên máy | Không |
| Vùng tài khoản, quốc gia kênh, email/số khôi phục | Checklist người vận hành khai (lưu dạng băm cho email/số) | Không |
| Danh sách binding và profile khác | CSDL ProfileVault + Fury | Không |

### 5.3 Checklist tài khoản (khai một lần, xác nhận lại mỗi 90 ngày)

Vùng tài khoản Google; quốc gia kênh YouTube; ngôn ngữ tài khoản; email khôi phục (băm); số điện thoại khôi phục (băm); 2FA đã bật; không đăng nhập tài khoản này ở trình duyệt/máy khác ngoài profile Fury; ngôn ngữ Studio đã đặt theo pack.

### 5.4 Khi nào chạy
Khi tạo binding; sau mỗi lần đổi proxy, đổi persona, nâng Fury, nhập file probe mới; định kỳ **[giả định] mỗi 7 ngày** cho các lớp không cần trình duyệt; trước mỗi lần lên mức.

### 5.5 Kết quả
Mỗi binding có **điểm nhất quán**: số luật đạt / tổng, danh sách luật trượt kèm giá trị thực tế và gợi ý sửa (ví dụ "đặt múi giờ profile = Europe/Berlin cho khớp exit Frankfurt"). ProfileVault **không tự sửa** cấu hình profile — người vận hành sửa trong Fury rồi chạy lại.

---

## 6. Phạm vi theo giai đoạn

| Giai đoạn | Trong phạm vi |
|---|---|
| **Ngay** (không cần ProfileVault) | Cài Fury, tạo profile, đăng nhập, upload tay — bắt đầu tích lũy thời gian L0 |
| **M-1 Spike** (trên kênh test) | Upload riêng tư bằng script qua CDP, theo dõi 1 tuần; xác minh đọc được cấu hình persona/múi giờ/ngôn ngữ của profile từ Fury; xuất và đọc được file probe; Fury trả trạng thái mở/đóng profile |
| **M0** | Binding + mức L0/L1; **kiểm tra độ nhất quán + checklist tài khoản**; dashboard độ sẵn sàng; khai báo sự kiện; kiểm tra proxy định kỳ; `session-check`; Runner + lịch; trang trạng thái; chạy nền; REST loopback |
| **M1** | Flow `youtube/upload` ở chế độ L2 (dừng trước nút cuối) và L3; flow `generic/probe`; Job service; MCP + token/scope cho app ngoài; contract package; audit |
| **M2** | Skill cho Claude |
| **M3+** | Nền tảng khác; Stagehand; VA; Telegram |

Dashboard và L0/L1 lên trước upload tự động vì cần dữ liệu từ ngày đầu.

---

## 7. Use case

### 7.1 UC1 — Thiết lập kênh lần đầu (thủ công, Fury)
Mỗi kênh: tạo **một profile Fury** gắn **một email** — persona Windows (cùng OS với máy), proxy ISP/residential tĩnh đúng thị trường với exit IP riêng, múi giờ và ngôn ngữ theo quốc gia của proxy. Mở profile, **tự đăng nhập email của kênh** trong cửa sổ đó (tool không bao giờ nhập mật khẩu), đặt ngôn ngữ YouTube Studio = English. Phiên được lưu trong profile.

### 7.2 UC2 — Gắn kênh với profile (M0)
Trên dashboard: chọn profile Fury, khai `platform` + ID kênh, thư mục file cho phép. Binding bắt đầu ở **L0**.

### 7.3 UC3 — Khai báo sự kiện thủ công (M0)
Ở L0/L1, người vận hành ghi nhanh trên dashboard (một chạm): đã upload; gặp yêu cầu xác minh; CAPTCHA; cảnh báo; bị đăng xuất; ghi chú. Đây là nguồn dữ liệu chính khi hệ thống chưa chạm trình duyệt. Sự kiện đỏ kích hoạt hạ mức như mục 4.

### 7.4 UC4 — Theo dõi sức khỏe tự động (M0)
- Mọi mức: kiểm tra exit proxy qua Fury theo lịch (không mở trình duyệt): IP, quốc gia, ASN, độ trễ.
- Mọi mức: ghi nhận phiên bản Fury, kết quả detect-suite người vận hành chạy (nhập kết quả `fury-detect gate`).
- L1+: `session-check` theo lịch (mặc định 1 lần/ngày, giờ ngẫu nhiên trong khung).

### 7.5 UC5 — Kiểm tra độ nhất quán profile (M0)
Khi gắn kênh, người vận hành điền checklist tài khoản và nhập file probe đầu tiên (mở trang probe của Fury trong profile, xuất kết quả). Hệ thống chạy bộ luật mục 5, hiện điểm nhất quán và gợi ý sửa. Người vận hành sửa trong Fury, chạy lại tới khi hết luật *chặn*. Kiểm tra tự chạy lại theo mục 5.4; từ M1, binding ≥ L1 chạy probe tự động bằng flow `generic/probe`.

### 7.6 UC6 — Dashboard độ sẵn sàng (M0)
Xem mục 8.

### 7.7 UC7 — Upload bán tự động (M1, L2)
Người vận hành (hoặc app) gửi job; flow mở profile, điền file + metadata, để riêng tư, **dừng ở màn hình cuối**; toast "sẵn sàng để bạn xem"; người vận hành kiểm tra trong cửa sổ, bấm hoàn tất, bấm "Đã xong" trên dashboard (flow đọc `video_id`).

### 7.8 UC8 — Upload tự động (M1, L3)
Như UC7 nhưng flow tự bấm và đọc `video_id`. Dừng `needs_user` khi phiên hết hạn, CAPTCHA, sai kênh, giao diện đổi.

**Đầu vào upload:** `channel_id`*, file video (đường dẫn + sha256)*, tiêu đề*, mô tả*, "dành cho trẻ em"*, `idempotency_key`*, thẻ, playlist (theo tên), ngôn ngữ video, nhãn nội dung thay đổi/tổng hợp, thumbnail, phụ đề. **[giả định: category/giấy phép/kiếm tiền dùng mặc định kênh]** **Kết quả:** `video_id`, URL Studio, `visibility: private`, cảnh báo.

### 7.9 UC9 — App khác gửi job (M1)
`jobs.submit('youtube/upload', account, input)`; job cho binding dưới L2 bị từ chối `LEVEL_TOO_LOW`; L2 → job dừng chờ người bấm; L3 → chạy hết.

### 7.10 UC10 — Vận hành qua Claude (M2)
"Kênh nào đủ điều kiện lên mức?", "Vì sao kênh X bị hạ về L0?", "Đẩy 3 video này lên kênh Y" (tôn trọng mức), "Viết flow đọc số liệu 28 ngày" (`flow-author`, chỉ chạy được ở binding đủ mức).

### 7.11 UC11 — Thêm flow/nền tảng (M2–M3)
Pack mới khai báo **mức tối thiểu** cần cho từng flow (ví dụ flow chỉ đọc cần L1, flow ghi cần L2/L3).

### 7.12 Use case đã xét và loại
Trả lời bình luận, like, sub, tăng view (chính sách tương tác giả).

---

## 8. Dashboard độ sẵn sàng

Trang chính của giao diện localhost.

### 8.1 Tổng quan (mọi kênh)
Mỗi dòng một binding: kênh, profile, **mức hiện tại**, số ngày ở mức, **tiến độ tới ngưỡng mức kế** (thanh % + điều kiện còn thiếu), cờ đỏ gần nhất, **điểm nhất quán** (số luật đạt, số luật *chặn* trượt), phiên bản Fury, exit proxy (quốc gia/ASN), lần kiểm tra cuối. Nút **"Lên mức"** chỉ sáng khi đạt ngưỡng.

### 8.2 Chi tiết một kênh
- **Dòng thời gian sự kiện:** khai báo tay, kiểm tra proxy, session-check, run flow, đổi mức (ai, khi nào, vì sao), nâng Fury.
- **Biểu đồ theo ngày/tuần:** số upload theo chế độ (tay / bán tự động / tự động); tỉ lệ thành công session-check và flow; số `needs_user` theo lý do; tuổi phiên (ngày kể từ lần đăng nhập lại gần nhất); lịch sử exit IP/quốc gia/ASN; kết quả detect-suite theo phiên bản Fury.
- **Bảng ngưỡng:** từng điều kiện của mức kế, giá trị hiện tại, đạt/chưa.
- **Độ nhất quán:** bảng luật theo 5 lớp (đạt/trượt, giá trị thực tế, gợi ý sửa), trạng thái checklist tài khoản, so sánh probe lần này với lần trước (giá trị nào đổi).

### 8.3 Hệ thống
Ma trận chéo giữa các kênh (exit IP, dải mạng, ASN, persona) để thấy ngay trùng lặp; tỉ lệ thành công theo flow; số `SITE_CHANGED` và bước bị vỡ; thời gian trung bình một upload; hàng đợi; số profile đang chạy; RAM.

### 8.4 Yêu cầu chung
Dữ liệu từ CSDL cục bộ, không gửi ra ngoài; xuất CSV; ngưỡng chỉnh được trong cài đặt (có ghi lịch sử thay đổi); xem được qua Claude (M2) bằng tool đọc.

---

## 9. Luồng chính

### 9.1 Lần đầu
1. Cài ProfileVault — nếu máy chưa có Fury, ProfileVault tự tải và cài Fury bản đã ghim (người dùng không phải cài riêng); mỗi kênh tạo một profile + proxy tĩnh trong Fury; tự đăng nhập email của kênh; đặt ngôn ngữ Studio.
2. Upload tay như bình thường **ngay từ ngày đầu** (bắt đầu tính thời gian L0).
3. Khi có M0: cài ProfileVault (chạy nền), bật automation API trong Fury, gắn từng kênh (L0), điền checklist tài khoản, nhập file probe, sửa đến khi hết luật *chặn*, khai báo các upload đã làm.

### 9.2 Mỗi upload theo mức
| Mức | Luồng |
|---|---|
| L0, L1 | Người vận hành tự upload trong profile → một chạm "Đã upload" trên dashboard |
| L2 | Gửi job → kiểm file/hash, chống trùng → chờ profile rảnh → mở, session-check, điền, dừng → người xem và bấm → "Đã xong" → đọc `video_id` |
| L3 | Như L2 nhưng flow tự bấm; dừng `needs_user` khi cần |

### 9.3 Khi có cờ đỏ
Hạ mức ngay, dừng job của binding, toast đỏ, dashboard ghi lý do; người vận hành xử lý trong Fury rồi tiếp tục ở mức mới.

### 9.4 Khi Fury ra bản mới
Không tự nâng. Chạy detect-suite + hồi quy flow trên kênh test → xanh thì nâng, nhập kết quả detect-suite và file probe mới cho các profile; kiểm tra độ nhất quán so với probe trước (chỉ phiên bản trình duyệt được đổi).

---

## 10. Yêu cầu chức năng

| # | Yêu cầu | GĐ |
|---|---|---|
| F1 | Binding kênh ↔ profile Fury, có mức L0–L3, thư mục file cho phép | M0 |
| F2 | Khai báo sự kiện thủ công một chạm (upload, xác minh, CAPTCHA, cảnh báo, đăng xuất, ghi chú) | M0 |
| F3 | Kiểm tra exit proxy qua Fury theo lịch, không mở trình duyệt | M0 |
| F4 | Ghi phiên bản Fury, nhập kết quả detect-suite theo profile | M0 |
| F5 | `session-check` chỉ đọc theo lịch cho binding ≥ L1 | M0 |
| F6 | Bộ quy tắc ngưỡng lên mức + quy tắc hạ mức tự động, cấu hình được | M0 |
| F7 | Dashboard: tổng quan, chi tiết kênh, hệ thống, xuất CSV (mục 8) | M0 |
| F8 | Lên mức chỉ khi đạt ngưỡng và người vận hành xác nhận; mọi đổi mức có audit | M0 |
| F9 | Runner: một run mỗi profile, kiểm tra profile không đang mở, giới hạn theo RAM, lịch có giờ ngẫu nhiên trong khung + chạy bù, checkpoint/resume | M0 |
| F10 | Runner từ chối flow có mức tối thiểu > mức binding (`LEVEL_TOO_LOW`) | M0 |
| F11 | Linter chặn bước đặt công khai/hẹn giờ ở mọi pack | M0 |
| F12 | Chạy nền (tray), tự khởi động; REST loopback + token cục bộ; toast | M0 |
| F13 | Bộ luật nhất quán 5 lớp (mục 5.1), mức chặn/cảnh báo cấu hình được, có lịch sử thay đổi | M0 |
| F14 | Nhập và phân tích file probe của Fury theo profile; lưu lịch sử, so sánh giữa các lần đo | M0 |
| F15 | Checklist tài khoản; email/số khôi phục lưu dạng băm, chỉ dùng để so trùng | M0 |
| F16 | Kiểm tra chéo giữa các binding (IP, dải mạng, ASN, persona + seed, khôi phục) | M0 |
| F17 | Flow `youtube/upload` hai chế độ: dừng trước nút cuối (L2) / chạy hết (L3) | M1 |
| F18 | Job service: `idempotency_key`, kiểm file, mã lỗi chuẩn, ánh xạ account → binding → flow | M1 |
| F19 | Flow `generic/probe` chạy probe tự động cho binding ≥ L1 | M1 |
| F20 | MCP + token/scope cho app ngoài; contract package + test; audit job | M1 |
| F21 | Skill: router, `account-setup`, `job-planner`, `health-check` (đọc dashboard), `flow-author` | M2 |
| F22 | `ai` (Stagehand) cho bước `fragile`; pack nền tảng khác | M3 |

---

## 11. Yêu cầu phi chức năng

| Mặt | Yêu cầu |
|---|---|
| An toàn tài khoản | L0 không bao giờ bật CDP; CDP chỉ bật trong lúc chạy; lịch session-check giờ ngẫu nhiên; giới hạn **[giả định] 10 upload/kênh/ngày**; không chạy song song trên cùng profile |
| Phản ứng rủi ro | Cờ đỏ → hạ mức và dừng job ≤ 1 phút sau khi ghi nhận |
| Hiệu năng | Upload 1080p 10 phút ≤ **[giả định] 15 phút**; tối đa **[giả định] 3** profile đồng thời khi máy bận, 6 khi rảnh |
| Tin cậy | Job sống sót qua tắt máy/crash; không tạo upload trùng |
| Bảo mật | Chỉ loopback; token băm; bí mật qua DPAPI; không log nội dung trang/cookie |
| Dữ liệu dashboard | Cục bộ, giữ ≥ 12 tháng, xuất CSV |
| Kiểm tra nhất quán | Các lớp không cần trình duyệt chạy ≤ 30 giây cho 10 binding; không bao giờ tự sửa cấu hình profile |
| Giấy phép | Fury (AGPL) là tiến trình riêng, không nhúng mã; ProfileVault tải và cài nguyên bản release chính thức (vấn đề giấy phép khi phân phối do chủ sản phẩm xử lý riêng) |
| Nền tảng | Windows 10/11; Node 22; Fury ≥ 0.2.21 |

---

## 12. Tiêu chí nghiệm thu

| GĐ | Nghiệm thu |
|---|---|
| M-1 | Trên kênh test: 3 upload riêng tư bằng script, đúng `video_id`, không cảnh báo trong 7 ngày; đọc được cấu hình persona/múi giờ/ngôn ngữ của profile từ Fury (API hoặc file); xuất được file probe và đọc lại được các trường cần cho mục 5.1; lấy được trạng thái mở/đóng profile từ Fury |
| M0 | Gắn 2 kênh ở L0; khai báo sự kiện hiện trên dòng thời gian; kiểm tra proxy chạy theo lịch và phát hiện đổi quốc gia khi cố tình đổi proxy → hạ mức + toast; giả lập đủ điều kiện → nút "Lên mức" sáng, lên L1 → session-check chạy theo lịch; khai báo CAPTCHA → về L0 và dừng; xuất CSV đúng; **nhất quán:** profile đặt múi giờ lệch exit → luật chặn trượt, nút "Lên mức" tắt, có gợi ý sửa; hai binding cùng exit IP → cả hai về L0; nhập probe hai lần cùng phiên bản Fury → hash khớp; checklist thiếu → không rời L0 |
| M1 | Kênh test ở L2: job dừng trước nút cuối, người bấm, nhận `video_id`; L3: 5 job liên tiếp xong, gửi lại cùng `idempotency_key` không trùng; tắt máy giữa chừng → tiếp tục; job cho kênh L1 → `LEVEL_TOO_LOW`; app mock gửi qua MCP với token hẹp |
| M2 | Qua Claude: hỏi "kênh nào đủ điều kiện lên mức" trả đúng như dashboard; đẩy 3 video lên kênh L3 |

---

## 13. Rủi ro sản phẩm

| Rủi ro | Ứng phó |
|---|---|
| Khai báo tay bị quên → dữ liệu L0 thiếu | Nhắc hằng ngày qua toast nếu có profile được mở mà chưa khai báo (Fury báo trạng thái mở/đóng); ngưỡng L0→L1 cần số upload tối thiểu |
| YouTube phản ứng với CDP ở L1/L2 | Hạ mức tự động; giữ kênh ở L0 lâu dài vẫn là trạng thái hợp lệ |
| Luật nhất quán quá chặt hoặc sai → chặn nhầm | Mức chặn/cảnh báo chỉnh được; mỗi luật có giải thích và giá trị thực tế; ghi lịch sử thay đổi luật |
| Persona trong danh mục Fury không khớp máy | Dùng `fury-detect persona` chụp từ chính máy chạy |
| Fury ngừng bảo trì | Ghim bản ổn; theo dõi fork |
| Studio đổi giao diện | `SITE_CHANGED` hạ L3→L2; sửa flow ≤ 2 giờ |

---

## 14. Giả định cần xác nhận

1. Ngưỡng lên mức ở mục 4 (14/14/30 ngày; 5/20 upload; 95%).
2. Category/giấy phép/kiếm tiền dùng mặc định kênh.
3. Thông báo M0 = dashboard + Windows toast; Telegram để M3.
4. VA ngoài M0–M2.
5. Giới hạn 10 upload/kênh/ngày; 3 profile đồng thời khi máy bận.
6. Có một kênh test riêng (tài khoản thử nghiệm) để spike và hồi quy.
7. Detect-suite và probe do người vận hành chạy và nhập kết quả ở L0 (Fury chưa có API trả kết quả theo profile — kiểm ở spike).
8. Bộ luật nhất quán khởi đầu ở mục 5.1; tối đa 3 profile cùng persona trên một ASN; chu kỳ kiểm 7 ngày; checklist xác nhận lại mỗi 90 ngày.
9. Fury cho đọc cấu hình persona/múi giờ/ngôn ngữ của profile (qua API hoặc file) — kiểm ở spike.
