# Rà soát source SFTP++ — 2026-10-13

Kết luận: code hiện tại là một fork dạng patch bundle, khó bảo trì và chưa có đủ kiểm chứng để gọi là ổn định trong renderer Tabby. Cần xử lý an toàn dữ liệu và tổ chức lại source, thay vì tiếp tục thêm wrapper mỗi khi một nút lỗi.

Phạm vi: 38 file CJS ngoài test (runtime, build/patch và tiện ích), 20 file test CJS, template/style, manifest, các điểm tương tác trong bundle gốc và bundle sinh ra. Parse 58 file CJS không có lỗi cú pháp. Không coi kết quả parse hay test fixture là kiểm chứng UI thật. CodeGraph chưa được khởi tạo; dùng AST của TypeScript và đọc các file cụ thể. Báo cáo không thay đổi hành vi plugin.

## Các vấn đề ưu tiên

### P1 — Download có thể ghi đè thay đổi local phát sinh trong lúc tải

[transfer-engine.cjs:82](transfer-engine.cjs#L82): engine lấy stamp đích trước khi tải, nhưng ngay trước fsp.rename(temp,local) không kiểm tra lại đích. Phía upload có bước kiểm tra thay đổi remote trước commit; phía download thiếu bước tương ứng.

Đã tái hiện trong thư mục tạm: fake SFTP handle sửa nội dung file local ở bước close, sau đó engine vẫn trả true và thay thế file đó bằng dữ liệu download. Nội dung mới của người dùng không được giữ. Không dùng server hay file thật của người dùng trong phép thử.

Hướng sửa: kiểm tra đích tại commit; khi đích đổi thì giữ partial và báo conflict. Cần chính sách bảo vệ thay thế nhất quán; kiểm tra stamp đơn thuần vẫn không loại bỏ toàn bộ race giữa check và rename.

### P1 — New file dùng check-then-write, có thể làm rỗng file vừa xuất hiện

Handler confirmInputDialog trong [index.original.js](index.original.js) kiểm tra stat rồi gọi writeFile mà không có cờ exclusive. Inline editor mới vẫn gọi handler này qua [inline-edit.cjs:20](inline-edit.cjs#L20).

Đã tái hiện bằng handler thật trong VM: phép kiểm tra báo chưa có file; một tác nhân khác tạo file trước bước write; New file sau đó ghi chuỗi rỗng lên file đó. Test tên trùng thông thường trước đây không bao phủ race này. New file remote cũng cần rà hợp đồng exclusive-create của adapter; không dựa vào một lần readdir trước upload để bảo đảm không ghi đè.

Hướng sửa: tạo file local độc quyền với wx và xử lý EEXIST; adapter remote cần thao tác create-exclusive hoặc chính sách tương đương được kiểm chứng.

### P2 — Build phụ thuộc bundle minified và thứ tự patch

[build.cjs:2](build.cjs#L2) đọc index.original.js (~1.95 MB), sửa bằng chuỗi/AST rồi nhúng runtime vào các symbol minified Xi/Wt/wr/tr và anchor const so=to. Không có cây src TypeScript nguyên bản để build lại độc lập. Có 133 vị trí once/replace/replaceAll trong các CJS được thống kê; đây là số vị trí text operation, không phải 133 lỗi.

Một bản upstream có thể đổi symbol/format và làm hỏng patch. Một số anchor có guard rất tốt; một số replace không kiểm tra số lần khớp. Parse vm.Script chỉ xác nhận cú pháp. Source map tương ứng cho các runtime nhúng chưa có.

Hướng sửa: lấy/khôi phục source có tên symbol và build chuẩn trước; tách adapter, transfer, edit-session, UI và diagnostics. Nếu phải giữ bundle bridge trong giai đoạn chuyển tiếp, tập trung bridge vào một lớp compatibility nhỏ, có version/hash và guard đầy đủ.

### P2 — Vòng đời và hành vi bị chồng nhiều lớp prototype override

AST tìm thấy Panel.ngOnDestroy bị gán tại 9 module, ngOnInit tại 4 module. ctxEditFile, ctxClipboardPaste, _activateEntry, _enableCwdReporterSession, _enableCwdReporterPermanent, _syncRemoteToTerminalCwd và một số handler cấu hình cũng bị ghi đè nhiều nơi.

Các wrapper thường lưu original rồi gọi tiếp, nhưng logic và quyền sở hữu timer/listener/session phân tán. Một thay đổi thứ tự build có thể thay đổi hành vi mà tên hàm không đổi. Không phải mọi phép ghi đè đều còn chạy: cwd thay thế một số implementation navigation; cleanup thay thế một số implementation cũ.

Ví dụ thực tế: [cleanup-runtime.cjs:38](cleanup-runtime.cjs#L38) đã tắt _startCwdSync. Bản tối ưu lag ở keyboard-events.cjs bọc lại hàm này ngoài Angular, nhưng thực tế bọc một hàm dừng timer. Phần đó không tạo lợi ích như commentary trước đã nói. Việc loại Angular HostListener toàn cục vẫn có hiệu lực; mức cải thiện latency thật chưa đo được.

Hướng sửa: một chủ sở hữu lifecycle với danh sách disposables; các service có API rõ ràng thay vì cùng sửa prototype. Xóa implementation đã bị thay thế, tránh giữ code chết để người sửa sau lần nhầm đường chạy.

### P2 — Test chưa tương ứng đầy đủ môi trường chạy thật

[package.json](package.json) dùng Angular 9.1 và Tabby 1.0.163 dev dependencies. Source map của Tabby đang cài xác nhận Angular 15.2.10. Test UI dùng vm.runInNewContext với service/DOM/Electron mock trong [test-context-menu.cjs:8](test-context-menu.cjs#L8); [test-ui-actions.cjs](test-ui-actions.cjs) kiểm tra parse template và tên handler, không thao tác giao diện thật.

Test native SFTP sử dụng addon đang cài và loopback ssh2, có giá trị cho bytes/mode/adapter. Nó chạy trong Node ngoài Electron, không tái tạo Angular/Zone/renderer. Một số đường queue trong fixture là bridge giản lược. Điều này giải thích tại sao readonly drag-over và AsyncLocalStorage fatal không bị bắt từ đầu.

Không có npm test/test-all và CI manifest trong source đã kiểm tra. Tài liệu nhắc test-transfer-engine.cjs cho bài 300 MiB, nhưng file này không có trong cây hiện tại; kết quả đó chưa có cách chạy lại từ repo hiện nay.

Hướng sửa: manifest runtime mục tiêu + một lệnh test tổng hợp; thêm smoke test trong Electron/Tabby đúng phiên bản, có click/key/drop, đóng/mở panel nhiều lần, renderer crash/hang event và ngưỡng latency. Cần khôi phục fixture/check không còn trong repo thay vì tiếp tục trích dẫn kết quả lịch sử.

### P2 — Bộ log tiến trình chính hiện chưa hoạt động

[tabby-diagnostics-loader.cjs:11](tabby-diagnostics-loader.cjs#L11) gọi remote.require. Log live gần nhất ghi renderer:diagnostics-install:error / remote:require / TypeError; không có main:diagnostics:ready. Test emitter pass không chứng minh hook đã được cài trong app thật.

Không được dùng sự vắng mặt của renderer:gone hay main heartbeat ở bộ log này để kết luận không có crash/hang. Cần một điểm khởi tạo main được hỗ trợ và xác nhận readiness thực tế; tắt observer này nếu chưa dùng được. Cleanup manifest đã có nhưng vẫn cần thực hiện sau khi xác nhận bản sửa.

### P2 — Export/copy source thiếu dependency mới

[sync-config.cjs:26](sync-config.cjs#L26) copyPlugin dùng danh sách file viết tay. Nó bỏ ít nhất patch-inline-edit.cjs, inline-edit.cjs, patch-keyboard-events.cjs, keyboard-events.cjs, remote-metadata.cjs, file-permissions.cjs, drop-diagnostics.cjs và clipboard-safety.cjs.

Dist được copy nên bản dựng sẵn có thể vẫn chạy, nhưng npm run build từ bản source đã copy sẽ thiếu module. Validate chỉ parse bundle, không xác nhận bản sao source build lại được.

Hướng sửa: một manifest build/package duy nhất, hoặc sao source theo quy tắc có kiểm soát; kiểm tra install/build từ một thư mục sạch.

### P2 — Sidebar enabled không kiểm soát việc mount sidebar

[sidebar.cjs:68](sidebar.cjs#L68) _customMountSidebar không kiểm tra sidebarEnabled; attach và togglePanelForActiveTerminal vẫn gọi mount. Settings getter/toggle có cờ, nhưng handler settings-changed chỉ đổi layout rồi tiếp tục layout sidebar.

Hướng sửa: xác định rõ enabled=false phải teardown hay bỏ mount, và kiểm tra bật/tắt trên một terminal đang sống.

## Lỗi trắng màn: bằng chứng và giới hạn

Crash dump 2026-10-13 09:05:25 UTC+7 ghi renderer, Electron 43.7.0, exception 0xc0000005, Tabby.exe+0x3a543ce. Crash annotation: Isolate::PushStackTraceAndDie / null prototype chain root. Stack JavaScript lưu trong dump: getStore -> _safeDetect trong drop-diagnostics.cjs -> customSyncNow -> Angular click.

Một dump upload trước đó có cùng địa chỉ crash và getStore -> uploadPathToRemote trong các wrapper activity/diagnostics. Đây là bằng chứng cụ thể cho đường AsyncLocalStorage.getStore, và đã loại đường native đó ở commit 8025b14. Nó không chứng minh tất cả sự cố trắng/lag đều chỉ có một nguyên nhân, cũng không thay thế xác nhận live sau restart.

Cách xử lý trước đã quá tập trung từng nút/queue trước khi đọc được native dump. Nhiều bản patch và test fixture pass đã tạo cảm giác đã sửa xong mà chưa có acceptance của renderer thật. Cần đổi cách kiểm chứng, không chỉ thêm catch.

## Những phần có thể giữ lại

- Engine dùng staging, kiểm tra bytes và metadata, giữ backup/rollback cho thay thế remote, giới hạn buffer và copy dữ liệu native sang buffer sở hữu.
- file-permissions.cjs tách chính sách 0764, chmod và kiểm tra mode khỏi UI.
- Guard session/destroy, chống mở edit trùng, và lưu bản local phục hồi có ích.
- Guard build-anchor và các test với addon native là nền tốt khi được đưa vào quy trình build/test thống nhất.

## Trình tự đề nghị

1. Dừng mở rộng tính năng trong giai đoạn ổn định; ưu tiên hai lỗi ghi đè dữ liệu đã tái hiện, ownership transfer giữa nhiều panel/process, và sidebar toggle.
2. Ghi build ID/runtime versions vào log; sửa hoặc tắt main observer lỗi; có một reproduction/harness renderer thật trước khi tuyên bố hết trắng.
3. Tạo manifest packaging + một test runner; đồng bộ dependencies với runtime mục tiêu và bổ sung bài race/lifecycle/typing.
4. Chuyển sang source chuẩn theo từng subsystem: adapter metadata/permission -> engine/queue/recovery -> edit-session -> UI/sidebar/inline input. Giữ snapshot và khả năng rollback từng bước.
5. Gom lifecycle/disposables; bỏ implementation bị ghi đè và diagnostics tạm sau khi acceptance pass.

Đây là audit và kế hoạch sửa; chưa thực hiện refactor hoặc sửa các lỗi dữ liệu được ghi trong báo cáo này.

## Follow-up: source migration 2.0

The old bundle-patch inputs were retired. Current source/build/test structure and remaining compatibility debt are documented in docs/ARCHITECTURE.md. The two reproduced data races now have regression checks; New file uses exclusive creation and download commit rechecks local changes. Angular/SDK dependencies were aligned, real Electron renderer smoke tests added, and empty ConfigProxy map persistence fixed. The failed main diagnostics loader was removed. The report above describes the pre-migration snapshot, not an assertion that every item remains unchanged.
