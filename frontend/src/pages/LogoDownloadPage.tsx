import React from "react";
import LogoDownload from "../components/common/LogoDownload";
import LogoMark from "../components/common/LogoMark";

const LogoDownloadPage: React.FC = () => {
  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-50 px-4 py-10 text-slate-900">
      <div className="w-full max-w-xl space-y-8 rounded-3xl bg-white px-8 py-10">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">Brand Assets</h1>
          <p className="text-sm text-slate-500">
            Download the latest Truematch logomark in multiple formats. The SVG
            and PNG offer a transparent background, while JPEG includes a soft
            white tile for quick sharing.
          </p>
        </header>

        <div className="flex justify-center">
          <div className="flex h-44 w-44 items-center justify-center rounded-full bg-slate-100/80 p-6">
            <LogoMark size={128} />
          </div>
        </div>

        <LogoDownload size={512} filenameBase="truematch-logomark" />
      </div>
    </div>
  );
};

export default LogoDownloadPage;
