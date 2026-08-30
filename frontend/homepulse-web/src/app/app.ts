import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { ThemeService } from './core/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class App implements OnInit {
  private translate = inject(TranslateService);
  private themeService = inject(ThemeService);

  ngOnInit(): void {
    this.translate.addLangs(['pt-BR', 'en', 'es']);
    const stored = localStorage.getItem('lang') ?? 'pt-BR';
    this.translate.use(stored);
    this.themeService.initTheme();
  }
}
