# Homebrew formula for the host command (knowledge/design/mac-install.md). Lives in the tap
# repository metor-com/homebrew-tap as Formula/metor.rb; this copy is the source of truth.
# On a release: point `url` at the tag's tarball, fill in `sha256` (shasum -a 256 <tarball>),
# then push the file to the tap. `brew install --HEAD metor-com/tap/metor` follows main.
class Metor < Formula
  desc "Delegable bots with their own computer – host command for the metor computer"
  homepage "https://github.com/metor-com/metor"
  url "https://github.com/metor-com/metor/archive/refs/tags/v0.2.0.tar.gz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000" # filled in on release
  license "Apache-2.0"
  head "https://github.com/metor-com/metor.git", branch: "main"

  def install
    # Only the wrapper; the computer itself is the published image. Building the image needs a checkout.
    inreplace "backend/harness/bin/metor", "METOR_VERSION_FALLBACK=dev", "METOR_VERSION_FALLBACK=#{version}"
    bin.install "backend/harness/bin/metor"
  end

  def caveats
    <<~EOS
      metor needs a container runtime. On an Apple silicon Mac with macOS 26:
        brew install container
      Otherwise Colima (brew install colima docker && colima start --cpu 4 --memory 8) or Docker Desktop.
      Then:
        metor setup
    EOS
  end

  test do
    assert_match "metor", shell_output("#{bin}/metor version")
  end
end
