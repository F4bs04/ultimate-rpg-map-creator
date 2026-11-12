import React, { useEffect, useState } from 'react';
import { DSLModal } from './components/DSLModal';
import { LeftSidebar } from './components/LeftSidebar';
import { MapManagerModal } from './components/MapManagerModal';
import { RightInspector } from './components/RightInspector';
import { TopToolbar } from './components/TopToolbar';
import { Viewport3D } from './components/Viewport3D';
import { createCidadeMedievalScene } from './core/cidadeMedievalScene';
import { createPortoRustymapsScene } from './core/portoRustymapsScene';
import { createTavernaMedievalScene } from './core/tavernaMedievalScene';
import { createValeRegionalScene } from './core/valeRegionalScene';
import { generateIsometricSample } from './core/sampleScenes';
import { useSceneStore } from './store/useSceneStore';

export const App: React.FC = () => {
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const initialMapParam = urlParams?.get('map');
  const initialModalParam = urlParams?.get('modal');

  const [dslOpen, setDslOpen] = useState(false);
  const [mapsModal, setMapsModal] = useState<{
    open: boolean;
    tab: 'library' | 'saved';
  }>({
    open: initialModalParam === 'maps' || initialModalParam === 'saved',
    tab: initialModalParam === 'saved' ? 'saved' : 'library',
  });
  const loadImageAndScene = useSceneStore((s) => s.loadImageAndScene);

  // Carrega cena inicial (com suporte a ?map=vale, ?map=porto, ?map=cidade, ?map=taverna)
  useEffect(() => {
    if (initialMapParam === 'porto') {
      loadImageAndScene(
        '/maps/porto-rustymaps.jpg',
        createPortoRustymapsScene()
      );
      return;
    }
    if (initialMapParam === 'cidade') {
      loadImageAndScene(
        '/maps/cidade-medieval-rustymaps.jpg',
        createCidadeMedievalScene()
      );
      return;
    }
    if (initialMapParam === 'taverna') {
      loadImageAndScene(
        '/maps/taverna-medieval.jpg',
        createTavernaMedievalScene()
      );
      return;
    }

    // Carrega o novo Vale dos Rios & Província Agrícola como cena padrão
    loadImageAndScene(
      '/maps/vale-regional.jpg',
      createValeRegionalScene()
    ).catch(() => {
      loadImageAndScene(
        '/maps/porto-rustymaps.jpg',
        createPortoRustymapsScene()
      ).catch(() => {
        loadImageAndScene(
          '/maps/cidade-medieval-rustymaps.jpg',
          createCidadeMedievalScene()
        ).catch(() => {
          const sample = generateIsometricSample();
          loadImageAndScene(sample.imageDataUrl, sample.scene);
        });
      });
    });
  }, [loadImageAndScene, initialMapParam]);

  return (
    <div className="w-screen h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      <TopToolbar
        onOpenDSL={() => setDslOpen(true)}
        onOpenMaps={(tab = 'library') => setMapsModal({ open: true, tab })}
      />
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <LeftSidebar />
        <Viewport3D />
        <RightInspector />
      </div>
      {dslOpen && <DSLModal onClose={() => setDslOpen(false)} />}
      {mapsModal.open && (
        <MapManagerModal
          initialTab={mapsModal.tab}
          onClose={() => setMapsModal((prev) => ({ ...prev, open: false }))}
        />
      )}
    </div>
  );
};

export default App;
