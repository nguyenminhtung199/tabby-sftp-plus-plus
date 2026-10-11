# SFTP++ và bộ cấu hình Tabby

Repo chứa plugin **SFTP++** đã build, source để sửa tiếp, danh sách phiên bản plugin đang dùng và một snapshot **config được mã hóa AES-256-GCM**. Không sửa source hay thư mục cài đặt Tabby.

Tài liệu tính năng SFTP++: [PLUGIN.md](PLUGIN.md).

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
