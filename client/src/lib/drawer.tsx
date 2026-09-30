import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ItemDrawer } from "@/components/ItemDrawer";

interface DrawerApi {
  openItem: (id: string) => void;
  close: () => void;
  openId: string | null;
}

const DrawerContext = createContext<DrawerApi | null>(null);

/** Mounts the single shared Item drawer and lets any page open it by id. */
export function ItemDrawerProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openItem = useCallback((id: string) => setOpenId(id), []);
  const close = useCallback(() => setOpenId(null), []);
  const value = useMemo<DrawerApi>(() => ({ openItem, close, openId }), [openItem, close, openId]);
  return (
    <DrawerContext.Provider value={value}>
      {children}
      <ItemDrawer itemId={openId} onClose={close} />
    </DrawerContext.Provider>
  );
}

export function useItemDrawer(): DrawerApi {
  const ctx = useContext(DrawerContext);
  if (!ctx) throw new Error("useItemDrawer must be used inside <ItemDrawerProvider>");
  return ctx;
}
