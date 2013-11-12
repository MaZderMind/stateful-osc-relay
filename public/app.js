$(function() {
	var
		$tbody = $('.guests-table tbody'),
		$nav = $('.main-nav'),
		$tabs = $('.tab'),
		sourceNames = {z: 'Zeroconf', s: 'Static'};

	// Navigation
	$nav.on('click', 'a', function() {
		var
			$a = $(this),
			target = $(this).attr('href').substr(1);

		navigateTo(target);
	});

	function navigateTo(target)
	{
		// store last page in cookie
		$.cookie('osc-nav', target);

		// shift focus on nav buttons
		$nav
			.find('li')
			.removeClass('active')
			.filter('.nav-'+target)
			.addClass('active');

		// shift focus on active tab
		$tabs
			.removeClass('active')
			.filter('.'+target+'-tab')
			.addClass('active');
	}

	// Permalink
	if(window.location.hash)
	{
		var target = window.location.hash.substr(1);
		navigateTo(target);
	}

	// Cookie
	
	if($.cookie('osc-nav'))
	{
		navigateTo($.cookie('osc-nav'));
	}



	// Socket communication
	var socket = io.connect(window.location.protocol+'//'+window.location.host, {
		'reconnection limit': 5000,
		'sync disconnect on unload': true
	});

	socket.on('update', function(reason, bundle) {
		console.log('update because of', reason, bundle);

		// clean and re-fill guest table
		$tbody.find('> tr').remove();
		if(bundle.g.length > 0)
		{
			for(var i = 0; i < bundle.g.length; i++) {
				var guest = bundle.g[i];

				$('<tr>')
					.appendTo($tbody)
					.append($('<td>').text(guest.n))
					.append($('<td>').text(guest.a + ':' + guest.p))
					.append($('<td>').text(  sourceNames[guest.s]  ));
			};
		}
		else {
			$('<tr>')
				.appendTo($tbody)
				.append(
					$('<td colspan="3" class="no-guests">')
						.text('Currently no guests are visible via Zeroconf. Maybe they need to be configured as static guests?')
				)
		}
	});
});