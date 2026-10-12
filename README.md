# SFTP++ và bộ cấu hình Tabby

Repo chứa plugin **SFTP++** đã build, source để sửa tiếp, danh sách phiên bản plugin đang dùng và một snapshot **config được mã hóa AES-256-GCM**. Không sửa source hay thư mục cài đặt Tabby.

Tài liệu tính năng SFTP++: [PLUGIN.md](PLUGIN.md).

## Dán ảnh và kéo file lên remote

- Upload/download file bị gián đoạn sẽ giữ partial và tự tiếp tục sau khi reconnect đúng server, nếu nguồn/đích chưa thay đổi. Với bản Tabby hiện tại, server cần **Python 3 (`python3`) và cho phép SSH exec** để tiếp tục theo offset; không cần sửa core Tabby.
- Click vùng danh sách file remote rồi bấm **Ctrl+V** để upload ảnh clipboard thành file `clipboard-...png` trong thư mục đang mở.
- Kéo file/thư mục từ File Explorer vào danh sách remote; thả lên một hàng folder để upload vào folder đó.
- Upload dùng queue và Transfer history hiện có. Ô path/filter vẫn dán văn bản bình thường.
- Bản staging của ảnh/file ảo được giữ tại `%APPDATA%\tabby\sftp-plus-plus\uploads` để còn nguồn retry khi upload lỗi; không đưa vào Git.

Kiểm tra luồng paste/drop bằng `node test-clipboard-upload.cjs`. Kiểm tra này dùng file và clipboard giả lập, không upload vào server thật.

## Cài trên máy Windows khác

1. Cài **Tabby**, **Git** và **Node.js LTS** (kèm npm). Nên dùng cùng phiên bản Tabby với máy cũ trước.
2. Mở Tabby một lần, sau đó đóng hoàn toàn Tabby.
3. Lấy file khóa `tabby-sync.key` từ máy cũ bằng USB hoặc một kênh riêng. Khóa hiện nằm tại `%APPDATA%\tabby\migration-secrets\tabby-sync.key` trên máy xuất. Giữ khóa ngoài repo, ví dụ `$env:USERPROFILE\tabby-sync.key`. Không commit khóa lên Git.
4. Mở PowerShell:

   ```powershell
   git clone https://github.com/nguyenminhtung199/tabby-sftp-plus-plus.git
   cd tabby-sftp-plus-plus
   node sync-config.cjs check --key "$env:USERPROFILE\tabby-sync.key"
   node sync-config.cjs install --key "$env:USERPROFILE\tabby-sync.key"
   ```

5. Mở lại Tabby. Plugin npm được cài theo lockfile; SFTP++ được liên kết tới `%APPDATA%\tabby\sftp-plus-plus` với bundle trong repo, không cần build.

Script khôi phục vào `%APPDATA%\tabby`, thay config hiện có bằng snapshot và cài lại danh sách plugin. Config và manifest cũ được sao lưu tại `%APPDATA%\tabby\migration-backup\git-restore-...`. `npm ci` thay nội dung `plugins/node_modules`; hãy export cấu hình riêng của máy mới trước nếu cần giữ lại. Nếu npm thất bại, config cũ chưa bị thay, nhưng các plugin có thể cần cài lại; dùng manifest trong backup để khôi phục.

### Những phần cần kiểm tra riêng

- SSH private key không nằm trong repo. Chép key riêng, chỉnh đường dẫn nếu tên user Windows khác.
- Mật khẩu lưu trong Windows Credential Manager/keychain không nằm trong `config.yaml`; có thể phải nhập lại. Nếu dùng Vault, giữ mật khẩu mở Vault.
- Đường dẫn download/local, font đã cài, chương trình mở file mặc định phụ thuộc máy mới.
- Cache, log, lịch sử lệnh, file đang edit và hàng đợi/recovery transfer không được chuyển. Hoàn tất upload các file đang sửa trên máy cũ trước.
- Nếu dùng Tabby portable với thư mục `data`, thêm `--root "D:\Tabby\data"` vào lệnh install.

## Cập nhật từ máy đang dùng

**Quy định cập nhật:** Bất kỳ thay đổi nào đối với plugin, config, danh sách plugin, script hoặc tài liệu đều phải được cập nhật vào repo, commit và push lên Git ngay sau khi hoàn tất và kiểm tra. Không để thay đổi chỉ nằm trên máy local. Quy định này áp dụng cả khi chỉnh sửa thủ công và khi nhờ coding agent thực hiện.

Nếu sửa source SFTP++, build lại `dist/` trước khi export. Nếu thay config hoặc bản plugin đang cài trên máy nguồn, chạy export theo hướng dẫn dưới đây trước khi commit. Với thay đổi chỉ ở script hoặc README trong repo, commit và push trực tiếp. Luôn giữ khóa giải mã và config chưa mã hóa ngoài Git.

Đóng Tabby sau khi lưu config. Export lấy config hiện tại, manifest/lockfile và bản SFTP++ hiện tại vào repo:

```powershell
cd <thu-muc-repo>
git pull --ff-only
node sync-config.cjs export --key "$env:APPDATA\tabby\migration-secrets\tabby-sync.key"
git add .
git commit -m "Update Tabby config and SFTP++"
git push
```

Export tạo khóa mới nếu đường dẫn chưa tồn tại. Khi cập nhật snapshot hiện tại, luôn dùng đúng khóa đang giữ; nếu đổi khóa, phải chuyển khóa mới sang máy kia.

Trên máy kia, đóng Tabby rồi chạy:

```powershell
cd <thu-muc-repo>
git pull --ff-only
node sync-config.cjs install --key "$env:USERPROFILE\tabby-sync.key"
```

Đây là đồng bộ theo lần export/install, chưa phải tự động thời gian thực. Chọn một máy làm nguồn để tránh máy này ghi đè thay đổi chưa export của máy kia.

## Chỉ cài SFTP++, không khôi phục config

Từ thư mục repo, đóng Tabby rồi chạy:

```powershell
$repoPath = (Get-Location).Path
Set-Location "$env:APPDATA\tabby\plugins"
npm.cmd install "$repoPath" --legacy-peer-deps
```

Giữ thư mục repo ở vị trí cố định vì npm có thể liên kết tới nó. Cách này không cần khóa giải mã và giữ config hiện tại của máy mới.

## Mã nguồn và giấy phép

Fork từ `tabby-sftp-plus@2.4.1` của DD1024z, giấy phép MIT, giữ tại [LICENSE](LICENSE). `dist/` là bản dùng trực tiếp. `assets/` và các module `.cjs` là source tùy chỉnh. Không đưa `migration-backup/`, `recovery/`, config rõ hoặc khóa giải mã lên Git. Repo private vẫn phù hợp vì snapshot chứa cấu hình cá nhân đã mã hóa.

## Sửa và kiểm thử plugin

Cài dependency phát triển tại thư mục repo rồi build lại bundle đang được Tabby liên kết:

```powershell
npm.cmd ci --legacy-peer-deps --ignore-scripts
npm.cmd run build
node test-context-menu.cjs
```

Menu Edit dùng cùng luồng mở file với double click, kể cả khi cấu hình single click. Menu Download mở hộp chọn thư mục local; hủy chọn hoặc đổi kết nối trong lúc chọn sẽ không tải file. Các lối gọi menu dùng chung xử lý lỗi và chờ menu đóng trước khi thực hiện. Khởi động lại Tabby để nạp bundle mới.


Menu chuột phải có **Open** (đổi tên từ Edit), **Open with…** (chọn ứng dụng .exe, vẫn tự upload khi lưu file remote), **Open terminal here** (chuyển terminal SSH đến thư mục tương ứng) và **Copy file name** (mỗi tên một dòng). Khởi động lại Tabby sau khi build để nạp menu mới.

Danh sách cấu hình menu chỉ có một mục **Open** dùng chung cho local và remote; thứ tự và trạng thái bật/tắt cũ được gộp khi đọc cấu hình.

File mới trên server mặc định **0764** (cấu hình `transfer-policy.json`). Khi upload hoặc tự sync, plugin giữ permission hiện tại trên server, xác minh quyền của file tạm trước khi thay file gốc; nếu đặt quyền thất bại thì báo lỗi và giữ file gốc.
