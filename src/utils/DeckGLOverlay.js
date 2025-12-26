/**
 * DeckGLOverlay - deck.gl 与 OpenLayers 集成辅助
 * 
 * 此类允许在 OpenLayers 地图上叠加 deck.gl 图层，
 * 利用 deck.gl 的 WebGL 渲染能力来提高大量点要素的渲染性能。
 * 
 * 核心原理：
 * 1. 创建一个与 OpenLayers 地图视口大小相同的 canvas
 * 2. 使用 deck.gl 在该 canvas 上渲染图层
 * 3. 监听 OpenLayers 的视图变化，同步更新 deck.gl 的视角
 */

import { Deck } from '@deck.gl/core';

export class DeckGLOverlay {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - 地图容器 DOM 元素
   * @param {import('ol/Map').default} options.map - OpenLayers 地图实例
   */
  constructor({ container, map }) {
    this.map = map;
    this.container = container;
    this.deck = null;
    this.layers = [];
    this._animationFrameId = null;
    
    this._init();
  }

  /**
   * 初始化 deck.gl 实例
   */
  _init() {
    // 创建 deck.gl 的 canvas 容器
    this.deckContainer = document.createElement('div');
    this.deckContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1;
    `;
    this.container.appendChild(this.deckContainer);

    // 获取初始视图状态
    const viewState = this._getViewState();

    // 初始化 deck.gl
    this.deck = new Deck({
      parent: this.deckContainer,
      style: { position: 'absolute', top: 0, left: 0 },
      initialViewState: viewState,
      controller: false, // 禁用 deck.gl 自身的交互控制器（由 OpenLayers 控制）
      layers: [],
      // 优化设置
      useDevicePixels: true,
      _animate: false,
    });

    // 监听 OpenLayers 地图移动事件，同步 deck.gl 视角
    this.map.on('moveend', () => this._syncViewState());
    this.map.on('movestart', () => this._syncViewState());
    this.map.getView().on('change:resolution', () => this._syncViewState());
    this.map.getView().on('change:center', () => this._syncViewState());
    this.map.getView().on('change:rotation', () => this._syncViewState());

    // 使用 requestAnimationFrame 持续同步（平滑动画）
    this._startSync();
  }

  /**
   * 开始持续同步视图状态
   */
  _startSync() {
    const sync = () => {
      this._syncViewState();
      this._animationFrameId = requestAnimationFrame(sync);
    };
    sync();
  }

  /**
   * 从 OpenLayers 获取当前视图状态
   * @returns {Object} deck.gl 格式的视图状态
   */
  _getViewState() {
    const view = this.map.getView();
    const center = view.getCenter();
    const zoom = view.getZoom();
    const rotation = view.getRotation();
    const size = this.map.getSize();

    if (!center || zoom === undefined || !size) {
      return {
        longitude: 114.307,
        latitude: 30.549,
        zoom: 12,
        bearing: 0,
        pitch: 0,
      };
    }

    // OpenLayers 使用 EPSG:3857 投影，需要转换为经纬度
    const [lon, lat] = this._toLonLat(center);

    return {
      longitude: lon,
      latitude: lat,
      // deck.gl 的 zoom 与 OpenLayers 的 zoom 转换
      // OpenLayers zoom 0 对应 Web Mercator 的 256px 瓦片
      // deck.gl 使用类似 Mapbox 的 zoom 定义
      zoom: zoom - 1,
      bearing: (-rotation * 180) / Math.PI,
      pitch: 0,
    };
  }

  /**
   * 将 EPSG:3857 坐标转换为经纬度
   * @param {Array} coord - [x, y] 坐标
   * @returns {Array} [lon, lat]
   */
  _toLonLat(coord) {
    const [x, y] = coord;
    const lon = (x * 180) / 20037508.34;
    const lat =
      (Math.atan(Math.exp((y * Math.PI) / 20037508.34)) * 360) / Math.PI - 90;
    return [lon, lat];
  }

  /**
   * 同步 OpenLayers 视图状态到 deck.gl
   */
  _syncViewState() {
    if (!this.deck) return;
    const viewState = this._getViewState();
    this.deck.setProps({ viewState });
  }

  /**
   * 设置 deck.gl 图层
   * @param {Array} layers - deck.gl 图层数组
   */
  setLayers(layers) {
    this.layers = layers;
    if (this.deck) {
      this.deck.setProps({ layers });
    }
  }

  /**
   * 获取当前图层
   * @returns {Array}
   */
  getLayers() {
    return this.layers;
  }

  /**
   * 销毁实例
   */
  destroy() {
    if (this._animationFrameId) {
      cancelAnimationFrame(this._animationFrameId);
    }
    if (this.deck) {
      this.deck.finalize();
      this.deck = null;
    }
    if (this.deckContainer && this.deckContainer.parentNode) {
      this.deckContainer.parentNode.removeChild(this.deckContainer);
    }
  }

  /**
   * 调整大小
   */
  resize() {
    if (this.deck) {
      this.deck.setProps({});
    }
  }
}

export default DeckGLOverlay;
