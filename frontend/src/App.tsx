import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import AppShell from "@/components/AppShell";
import { useMe } from "@/hooks/useAuth";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import POS from "@/pages/POS";
import Riwayat from "@/pages/Riwayat";
import RiwayatTukar from "@/pages/RiwayatTukar";
import Stok from "@/pages/Stok";
import TransferStok from "@/pages/TransferStok";
import Label from "@/pages/Label";
import OpnamePage from "@/pages/OpnamePage";
import Kas from "@/pages/Kas";
import Produk from "@/pages/Produk";
import Laporan from "@/pages/Laporan";
import Pengguna from "@/pages/Pengguna";
import Pengaturan from "@/pages/Pengaturan";

/** Halaman admin-only: kasir dialihkan ke dashboard, bukan diberi layar kosong. */
function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isAdmin } = useMe();
  if (isLoading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const shell = (node: React.ReactNode) => <AppShell>{node}</AppShell>;

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={shell(<Dashboard />)} />
        <Route path="/transaksi" element={shell(<POS />)} />
        <Route path="/riwayat" element={shell(<Riwayat />)} />
        <Route path="/riwayat-tukar" element={shell(<RiwayatTukar />)} />
        <Route path="/stok" element={shell(<Stok />)} />
        <Route path="/transfer" element={shell(<TransferStok />)} />
        <Route path="/label" element={shell(<Label />)} />
        <Route path="/opname" element={shell(<OpnamePage />)} />
        <Route path="/kas" element={shell(<Kas />)} />
        <Route
          path="/produk"
          element={<AdminOnly>{shell(<Produk />)}</AdminOnly>}
        />
        <Route
          path="/laporan"
          element={<AdminOnly>{shell(<Laporan />)}</AdminOnly>}
        />
        <Route
          path="/pengguna"
          element={<AdminOnly>{shell(<Pengguna />)}</AdminOnly>}
        />
        <Route
          path="/pengaturan"
          element={<AdminOnly>{shell(<Pengaturan />)}</AdminOnly>}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster richColors />
    </>
  );
}
