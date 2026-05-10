import { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';

export default function MarketPage() {
  const [marketUrl, setMarketUrl] = useState('');

  useEffect(() => {
    window.electronAPI.getEnvConfig().then((config) => {
      setMarketUrl(`${config.appFeUrl}/app#/market`);
    });
  }, []);

  const handleRefresh = () => {
    if (marketUrl) {
      // 通过修改 key 强制 iframe 重新加载
      setMarketUrl('');
      setTimeout(() => {
        window.electronAPI.getEnvConfig().then((config) => {
          setMarketUrl(`${config.appFeUrl}/app#/market`);
        });
      }, 100);
    }
  };

  const handleOpenExternal = () => {
    if (marketUrl) {
      window.electronAPI.openExternal(marketUrl);
    }
  };

  return (
    <div className="market-page">
      <div className="market-header">
        <span className="market-title">消息市场</span>
        <div className="market-actions">
          <button className="icon-btn" onClick={handleRefresh} title="刷新">
            <RefreshCw size={14} />
          </button>
          <button className="icon-btn" onClick={handleOpenExternal} title="在浏览器中打开">
            <ExternalLink size={14} />
          </button>
        </div>
      </div>
      <div className="market-content">
        {marketUrl && (
          <iframe
            className="market-iframe"
            src={marketUrl}
            title="消息市场"
            sandbox="allow-scripts allow-same-origin allow-popups"
          />
        )}
      </div>
    </div>
  );
}
